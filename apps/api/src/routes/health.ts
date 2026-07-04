import type { FastifyInstance } from 'fastify';

import { checkObservabilityHealth } from '@/lib/observability';
import { isPineconeHealthy } from '@/lib/pinecone';
import { isRedisHealthy } from '@/lib/redis';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [redisHealthy, pineconeHealthy] = await Promise.all([
      isRedisHealthy(),
      isPineconeHealthy(),
    ]);

    const status = redisHealthy && pineconeHealthy ? 'ok' : 'degraded';
    const httpStatus = redisHealthy ? 200 : 503;

    return reply.status(httpStatus).send({
      status,
      timestamp: new Date().toISOString(),
      redis: redisHealthy ? 'up' : 'down',
      pinecone: pineconeHealthy ? 'up' : 'down',
    });
  });

  app.get('/health/detailed', async (_request, reply) => {
    const [redisHealthy, pineconeHealthy, observability] = await Promise.all([
      isRedisHealthy(),
      isPineconeHealthy(),
      checkObservabilityHealth(),
    ]);

    const checks = {
      redis: redisHealthy,
      pinecone: pineconeHealthy,
      datadog: observability.datadog,
      sentry: observability.sentry,
      langsmith: observability.langsmith,
    };

    const criticalOk = redisHealthy;
    const status = criticalOk
      ? Object.values(checks).every(Boolean)
        ? 'ok'
        : 'degraded'
      : 'down';

    return reply.status(criticalOk ? 200 : 503).send({
      status,
      timestamp: new Date().toISOString(),
      checks: {
        ...checks,
        lastErrorTimestamp: observability.lastErrorTimestamp,
      },
      datadog: observability.datadog ? 'up' : 'down',
      sentry: observability.sentry ? 'up' : 'down',
      langsmith: observability.langsmith ? 'up' : 'down',
      lastErrorTimestamp: observability.lastErrorTimestamp,
    });
  });
}
