import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { isPublicApiPath } from '@/lib/public-routes';
import { checkRateLimit } from '@/lib/redis';

const IP_MAX = 100;
const MERCHANT_MAX = 1000;
const WINDOW_SECONDS = 60;

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || request.ip;
  }
  return request.ip;
}

const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    if (isPublicApiPath(request.url)) {
      return;
    }

    const ip = getClientIp(request);
    const ipResult = await checkRateLimit(
      `ratelimit:ip:${ip}`,
      IP_MAX,
      WINDOW_SECONDS,
    );

    reply.header('X-RateLimit-Limit-IP', IP_MAX);
    reply.header('X-RateLimit-Remaining-IP', ipResult.remaining);

    if (!ipResult.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((ipResult.resetAt - Date.now()) / 1000),
      );
      reply.header('Retry-After', retryAfter);
      return reply.status(429).send({
        error: { message: 'Too Many Requests', statusCode: 429 },
      });
    }

    const merchantId = request.auth?.merchantId ?? request.session?.merchantId;
    if (!merchantId) {
      return;
    }

    const merchantResult = await checkRateLimit(
      `ratelimit:merchant:${merchantId}`,
      MERCHANT_MAX,
      WINDOW_SECONDS,
    );

    reply.header('X-RateLimit-Limit', MERCHANT_MAX);
    reply.header('X-RateLimit-Remaining', merchantResult.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(merchantResult.resetAt / 1000));

    if (!merchantResult.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((merchantResult.resetAt - Date.now()) / 1000),
      );
      reply.header('Retry-After', retryAfter);
      return reply.status(429).send({
        error: { message: 'Too Many Requests', statusCode: 429 },
      });
    }
  });
};

export default fp(rateLimitPlugin, {
  name: 'redis-rate-limit',
  dependencies: ['auth'],
});
