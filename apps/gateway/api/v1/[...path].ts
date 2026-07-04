import { authenticateRequest } from '../../src/lib/auth';
import { MAX_BODY_BYTES } from '../../src/lib/config';
import { corsHeaders } from '../../src/lib/cors';
import { proxyToBackend, resolveBackendPath } from '../../src/lib/proxy';
import {
  checkRateLimit,
  rateLimitKeyFromRequest,
} from '../../src/lib/rateLimit';
import { errorResponse, readBodyWithLimit } from '../../src/lib/request';
import { withGateway } from '../../src/lib/withGateway';

export const config = {
  runtime: 'edge',
  regions: ['iad1', 'sfo1', 'cdg1', 'hnd1', 'syd1'],
  maxDuration: 30,
};

function validateContentType(request: Request): string | null {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return null;
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return 'Content-Type must be application/json';
  }

  return null;
}

async function v1Handler(
  request: Request,
  context: { requestId: string },
): Promise<Response> {
  const origin = request.headers.get('origin');
  const baseHeaders = corsHeaders(origin);

  const contentTypeError = validateContentType(request);
  if (contentTypeError) {
    return errorResponse(415, contentTypeError, {
      requestId: context.requestId,
      headers: baseHeaders,
    });
  }

  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return errorResponse(auth.status, auth.message, {
      requestId: context.requestId,
      headers: baseHeaders,
    });
  }

  const rate = await checkRateLimit(
    rateLimitKeyFromRequest(request, auth.subject),
  );

  const rateHeaders = new Headers(baseHeaders);
  rateHeaders.set('X-RateLimit-Limit', String(rate.limit));
  rateHeaders.set('X-RateLimit-Remaining', String(rate.remaining));
  rateHeaders.set('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));

  if (!rate.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((rate.resetAt - Date.now()) / 1000),
    );
    rateHeaders.set('Retry-After', String(retryAfter));
    return errorResponse(429, 'Too Many Requests', {
      requestId: context.requestId,
      headers: rateHeaders,
    });
  }

  const url = new URL(request.url);
  // /api/v1/<path> or /v1/<path> depending on rewrite
  const parts = url.pathname
    .replace(/^\/api/, '')
    .split('/')
    .filter(Boolean);
  // parts: ['v1', 'conversations', ...]
  const pathSegments = parts[0] === 'v1' ? parts.slice(1) : parts;
  const backendPath = resolveBackendPath(pathSegments);

  if (!backendPath) {
    return errorResponse(404, 'Route not found', {
      requestId: context.requestId,
      headers: rateHeaders,
    });
  }

  let body: ArrayBuffer | null = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      const limited = bodyResult.response;
      const headers = new Headers(limited.headers);
      for (const [key, value] of rateHeaders.entries()) {
        headers.set(key, value);
      }
      return new Response(limited.body, {
        status: limited.status,
        headers,
      });
    }
    body = bodyResult.body;
  }

  const proxied = await proxyToBackend(request, backendPath, {
    requestId: context.requestId,
    body,
  });

  const headers = new Headers(proxied.headers);
  for (const [key, value] of rateHeaders.entries()) {
    headers.set(key, value);
  }

  return new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers,
  });
}

export default withGateway(v1Handler);
