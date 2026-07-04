export function createRequestId(existing?: string | null): string {
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }
  return crypto.randomUUID();
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit & { requestId?: string } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.requestId) {
    headers.set('X-Request-ID', init.requestId);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function errorResponse(
  status: number,
  message: string,
  options: {
    requestId?: string;
    headers?: HeadersInit;
    retry?: boolean;
  } = {},
): Response {
  const headers = new Headers(options.headers);
  if (options.retry) {
    headers.set('Retry-After', '5');
  }

  return jsonResponse(
    {
      error: {
        message,
        statusCode: status,
        ...(options.retry ? { retry: true } : {}),
      },
    },
    {
      status,
      headers,
      requestId: options.requestId,
    },
  );
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; body: ArrayBuffer } | { ok: false; response: Response }
> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      ok: false,
      response: errorResponse(413, `Request body exceeds ${maxBytes} bytes`),
    };
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) {
    return {
      ok: false,
      response: errorResponse(413, `Request body exceeds ${maxBytes} bytes`),
    };
  }

  return { ok: true, body };
}
