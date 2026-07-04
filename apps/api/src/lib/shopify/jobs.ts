import { getLogger } from '@/lib/observability';
import { getRedis } from '@/lib/redis';

import { syncOrders, syncPolicies, syncProducts } from './sync';

const STREAM_KEY = 'jobs:shopify';
const GROUP_NAME = 'shopify-workers';
const CONSUMER_NAME = `worker-${process.pid}`;

export type ShopifyJobType = 'sync_products' | 'sync_policies' | 'sync_orders';

export type ShopifyJobPayload = {
  type: ShopifyJobType;
  merchantId: string;
};

let workerRunning = false;

/**
 * Enqueue a background Shopify sync job on Redis Streams.
 */
export async function enqueueShopifyJob(
  type: ShopifyJobType,
  merchantId: string,
): Promise<void> {
  await getRedis().xadd(
    STREAM_KEY,
    '*',
    'type',
    type,
    'merchantId',
    merchantId,
    'enqueuedAt',
    new Date().toISOString(),
  );

  getLogger().info({ type, merchantId }, 'Enqueued Shopify job');
}

async function ensureConsumerGroup(): Promise<void> {
  try {
    await getRedis().xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('BUSYGROUP')) {
      throw error;
    }
  }
}

async function processJob(job: ShopifyJobPayload): Promise<void> {
  switch (job.type) {
    case 'sync_products':
      await syncProducts(job.merchantId);
      break;
    case 'sync_policies':
      await syncPolicies(job.merchantId);
      break;
    case 'sync_orders':
      await syncOrders(job.merchantId);
      break;
    default:
      getLogger().warn({ job }, 'Unknown Shopify job type');
  }
}

/**
 * Starts a Redis Streams consumer loop for Shopify background jobs.
 */
export async function startShopifyJobWorker(): Promise<void> {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  await ensureConsumerGroup();
  const log = getLogger();
  log.info('Shopify job worker started');

  const poll = async () => {
    while (workerRunning) {
      try {
        const results = (await getRedis().xreadgroup(
          'GROUP',
          GROUP_NAME,
          CONSUMER_NAME,
          'COUNT',
          5,
          'BLOCK',
          2000,
          'STREAMS',
          STREAM_KEY,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!results) {
          continue;
        }

        for (const stream of results) {
          const messages = stream[1];

          for (const [id, fields] of messages) {
            const data: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
              const key = fields[i];
              const value = fields[i + 1];
              if (key && value !== undefined) {
                data[key] = value;
              }
            }

            const job: ShopifyJobPayload = {
              type: data.type as ShopifyJobType,
              merchantId: data.merchantId ?? '',
            };

            try {
              await processJob(job);
              await getRedis().xack(STREAM_KEY, GROUP_NAME, id);
            } catch (error) {
              log.error({ err: error, job, id }, 'Shopify job failed');
              // Leave unacked for retry via pending entries
            }
          }
        }
      } catch (error) {
        log.error({ err: error }, 'Shopify job worker loop error');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void poll();
}

export function stopShopifyJobWorker(): void {
  workerRunning = false;
}
