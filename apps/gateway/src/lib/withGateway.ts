import { corsHeaders, handlePreflight, isAllowedOrigin } from './cors';
import { createRequestId } from './request';

export type GatewayContext = {
  requestId: string;
  startedAt: number;
};

type GatewayHandler = (
  request: Request,
  context: GatewayContext,
) => Promise<Response> | Response;

/**
 * Shared edge "middleware": request ID, CORS preflight, timing logs/headers.
 */
export function withGateway(handler: GatewayHandler) {
  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = createRequestId(request.headers.get('x-request-id'));
    const origin = request.headers.get('origin');

    const preflight = handlePreflight(request);
    if (preflight) {
      const headers = new Headers(preflight.headers);
      headers.set('X-Request-ID', requestId);
      headers.set('Server-Timing', `gateway;dur=${Date.now() - startedAt}`);
      console.log(
        JSON.stringify({
          msg: 'gateway_preflight',
          requestId,
          durationMs: Date.now() - startedAt,
          origin,
          status: preflight.status,
        }),
      );
      return new Response(null, { status: preflight.status, headers });
    }

    try {
      const response = await handler(request, { requestId, startedAt });
      const headers = new Headers(response.headers);
      headers.set('X-Request-ID', requestId);
      headers.set('Server-Timing', `gateway;dur=${Date.now() - startedAt}`);

      if (origin && isAllowedOrigin(origin)) {
        for (const [key, value] of Object.entries(corsHeaders(origin))) {
          headers.set(key, value);
        }
      }

      console.log(
        JSON.stringify({
          msg: 'gateway_request',
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
        }),
      );

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'gateway_error',
          requestId,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'Server-Timing': `gateway;dur=${Date.now() - startedAt}`,
      });

      if (origin && isAllowedOrigin(origin)) {
        for (const [key, value] of Object.entries(corsHeaders(origin))) {
          headers.set(key, value);
        }
      }

      return new Response(
        JSON.stringify({
          error: {
            message: 'Internal gateway error',
            statusCode: 500,
          },
        }),
        { status: 500, headers },
      );
    }
  };
}
