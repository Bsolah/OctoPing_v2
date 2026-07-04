import './instrumentation';

import {
  startAnalyticsDailyJob,
  stopAnalyticsDailyJob,
} from '@/jobs/analytics-daily';
import { shutdownAnalytics } from '@/lib/analytics/events';
import {
  captureException,
  flushObservability,
  getLogger,
} from '@/lib/observability';
import { connectPinecone, processPineconeRetryQueue } from '@/lib/pinecone';
import { connectRedis, disconnectRedis } from '@/lib/redis';
import {
  startShopifyJobWorker,
  stopShopifyJobWorker,
} from '@/lib/shopify/jobs';
import { buildApp } from '@/app';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  const log = getLogger();

  try {
    await connectRedis();
    await startShopifyJobWorker();
    startAnalyticsDailyJob();
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

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server');
    try {
      stopAnalyticsDailyJob();
      stopShopifyJobWorker();
      await shutdownAnalytics();
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
    stopAnalyticsDailyJob();
    stopShopifyJobWorker();
    await shutdownAnalytics();
    await disconnectRedis();
    await flushObservability();
    process.exit(1);
  }
}

void start();
