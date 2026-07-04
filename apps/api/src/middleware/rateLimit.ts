import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { checkRateLimit } from '@/lib/redis';

const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_WINDOW_SECONDS = 60;

function isHealthCheck(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? '';
  return path === '/health' || path.startsWith('/health/');
}

function getEndpoint(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? request.url;
}

const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    if (isHealthCheck(request)) {
      return;
    }

    const merchantId = request.session?.merchantId;
    if (!merchantId) {
      return;
    }

    const endpoint = getEndpoint(request);
    const key = `ratelimit:${merchantId}:${endpoint}`;
    const result = await checkRateLimit(
      key,
      DEFAULT_MAX_REQUESTS,
      DEFAULT_WINDOW_SECONDS,
    );

    void reply.header('X-RateLimit-Limit', DEFAULT_MAX_REQUESTS);
    void reply.header('X-RateLimit-Remaining', result.remaining);
    void reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000),
      );

      void reply.header('Retry-After', retryAfter);

      return reply.status(429).send({
        error: {
          message: 'Too Many Requests',
          statusCode: 429,
        },
      });
    }
  });
};

export default fp(rateLimitPlugin, {
  name: 'redis-rate-limit',
  dependencies: ['session'],
});
