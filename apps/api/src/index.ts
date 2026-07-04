import './instrumentation';

import Fastify from 'fastify';

import {
  captureException,
  createRequestLogger,
  flushObservability,
  getLogger,
} from '@/lib/observability';
import { connectPinecone, processPineconeRetryQueue } from '@/lib/pinecone';
import { connectRedis, disconnectRedis } from '@/lib/redis';
import rateLimitPlugin from '@/middleware/rateLimit';
import securityPlugin, { MAX_BODY_BYTES } from '@/middleware/security';
import sessionPlugin from '@/middleware/session';
import { healthRoutes } from '@/routes/health';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function buildServer() {
  const app = Fastify({
    logger: getLogger(),
    disableRequestLogging: false,
    bodyLimit: MAX_BODY_BYTES,
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      if (typeof header === 'string' && header.length > 0) {
        return header;
      }
      return crypto.randomUUID();
    },
  });

  await app.register(securityPlugin);
  await app.register(sessionPlugin);
  await app.register(rateLimitPlugin);

  app.addHook('onRequest', async (request) => {
    const merchantId = request.session?.merchantId;
    request.log = createRequestLogger({
      requestId: request.id,
      method: request.method,
      url: request.url,
      ...(merchantId ? { merchantId } : {}),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // Never leak secrets in client-facing errors
    const safeMessage =
      error.statusCode && error.statusCode < 500
        ? error.message
        : 'Internal Server Error';

    captureException(error, {
      url: request.url,
      merchantId: request.session?.merchantId,
      userId: request.session?.userId,
    });

    request.log.error(
      {
        err: {
          message: error.message,
          stack: error.stack,
          statusCode: error.statusCode,
        },
        url: request.url,
        method: request.method,
      },
      'Request failed',
    );

    const statusCode = error.statusCode ?? 500;

    reply.status(statusCode).send({
      error: {
        message: safeMessage,
        statusCode,
      },
    });
  });

  await app.register(healthRoutes);

  return app;
}

async function start() {
  const log = getLogger();

  try {
    await connectRedis();
  } catch (err) {
    captureException(err, { extra: { phase: 'redis_connect' } });
    log.error({ err }, 'Failed to connect to Redis');
    process.exit(1);
  }

  try {
    await connectPinecone();
    const replayed = await processPineconeRetryQueue();
    if (replayed > 0) {
      log.info({ replayed }, 'Replayed queued Pinecone vectors');
    }
  } catch (err) {
    captureException(err, { extra: { phase: 'pinecone_connect' } });
    log.error({ err }, 'Failed to connect to Pinecone');
    process.exit(1);
  }

  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server');
    try {
      await app.close();
      await disconnectRedis();
      await flushObservability();
      app.log.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      captureException(err, { extra: { phase: 'shutdown' } });
      app.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    captureException(err, { extra: { phase: 'listen' } });
    app.log.error(err);
    await disconnectRedis();
    await flushObservability();
    process.exit(1);
  }
}

void start();
