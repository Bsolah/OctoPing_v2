import { getApiBackendUrl } from './config';

const PROXY_PREFIXES = [
  'conversations',
  'ai',
  'analytics',
  'knowledge-base',
] as const;

/**
 * Rewrites /v1/<segment>/... → <API_BACKEND_URL>/<segment>/...
 */
export function resolveBackendPath(pathSegments: string[]): string | null {
  if (pathSegments.length === 0) {
    return null;
  }

  const [head, ...rest] = pathSegments;
  if (
    !head ||
    !PROXY_PREFIXES.includes(head as (typeof PROXY_PREFIXES)[number])
  ) {
    return null;
  }

  const suffix = rest.length > 0 ? `/${rest.join('/')}` : '';
  return `/${head}${suffix}`;
}

export async function proxyToBackend(
  request: Request,
  backendPath: string,
  options: {
    requestId: string;
    body?: ArrayBuffer | null;
  },
): Promise<Response> {
  const backendUrl = new URL(backendPath, `${getApiBackendUrl()}/`);
  const incomingUrl = new URL(request.url);
  backendUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('X-Request-ID', options.requestId);
  headers.set('X-Forwarded-By', 'nova-gateway');

  let backendResponse: Response;
  try {
    backendResponse = await fetch(backendUrl, {
      method: request.method,
      headers,
      body:
        options.body && request.method !== 'GET' && request.method !== 'HEAD'
          ? options.body
          : undefined,
      redirect: 'manual',
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          message: 'API backend unavailable',
          statusCode: 503,
          retry: true,
        },
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '5',
          'X-Request-ID': options.requestId,
        },
      },
    );
  }

  if (backendResponse.status >= 502) {
    const headersOut = new Headers(backendResponse.headers);
    headersOut.set('Retry-After', '5');
    headersOut.set('X-Request-ID', options.requestId);
    headersOut.set('Content-Type', 'application/json');

    return new Response(
      JSON.stringify({
        error: {
          message: 'Bad gateway',
          statusCode: backendResponse.status,
          retry: true,
        },
      }),
      {
        status: backendResponse.status,
        headers: headersOut,
      },
    );
  }

  const responseHeaders = new Headers(backendResponse.headers);
  responseHeaders.set('X-Request-ID', options.requestId);

  // Cache GET knowledge-base responses at the edge/CDN
  if (
    request.method === 'GET' &&
    (backendPath === '/knowledge-base' ||
      backendPath.startsWith('/knowledge-base/'))
  ) {
    responseHeaders.set(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=30',
    );
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  });
}

export async function isApiHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBackendUrl()}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
