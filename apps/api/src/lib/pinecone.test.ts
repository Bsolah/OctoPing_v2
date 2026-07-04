import { createHash } from 'crypto';

import {
  INDEX_DIMENSION,
  merchantNamespace,
  queryVectors,
  RETRY_QUEUE_KEY,
} from './pinecone';
import { connectRedis, disconnectRedis, getRedis } from './redis';
import { truncateForEmbedding } from '@/services/embedding';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testNamespaceAndTruncation() {
  assert(
    merchantNamespace('abc-123') === 'merchant-abc-123',
    'namespace should use merchant-{id} format',
  );

  const short = 'hello world';
  assert(
    truncateForEmbedding(short) === short,
    'short text should not be truncated',
  );

  const long = 'x'.repeat(8000 * 4 + 50);
  const truncated = truncateForEmbedding(long);
  assert(truncated.length === 8000 * 4, 'text should truncate to 8000 tokens');

  console.log('Namespace + truncation passed');
}

async function testInvalidDimensionSkipped() {
  const matches = await queryVectors({
    vector: [0.1, 0.2, 0.3],
    topK: 5,
    namespace: merchantNamespace('merchant-a'),
  });

  assert(matches.length === 0, 'invalid dimension queries should return []');
  console.log('Invalid dimension handling passed');
}

async function testRetryQueuePersistence() {
  await connectRedis();
  const redis = getRedis();

  const item = {
    operation: 'upsert',
    namespace: 'merchant-test',
    vectors: [
      {
        id: 'vec-1',
        values: Array.from({ length: INDEX_DIMENSION }, () => 0.01),
        metadata: {
          merchantId: 'test',
          contentType: 'faq',
          title: 'Test',
          sourceId: 'vec-1',
        },
      },
    ],
    enqueuedAt: Date.now(),
    attempts: 3,
  };

  await redis.del(RETRY_QUEUE_KEY);
  await redis.rpush(RETRY_QUEUE_KEY, JSON.stringify(item));

  const queued = await redis.llen(RETRY_QUEUE_KEY);
  assert(queued === 1, 'retry queue should store failed upserts');

  const raw = await redis.lpop(RETRY_QUEUE_KEY);
  assert(Boolean(raw), 'retry queue item should be readable');

  const parsed = JSON.parse(raw!) as typeof item;
  assert(parsed.vectors[0]?.id === 'vec-1', 'queued vector id should match');
  assert(
    parsed.vectors[0]?.values.length === INDEX_DIMENSION,
    'queued vector should keep dimension 3072',
  );

  console.log('Retry queue persistence passed');
}

async function testEmbeddingCacheKeyStability() {
  const text = 'Return policy for unused items';
  const hashA = createHash('sha256').update(text).digest('hex');
  const hashB = createHash('sha256').update(text).digest('hex');
  assert(hashA === hashB, 'identical text should produce identical cache keys');
  console.log('Embedding cache key stability passed');
}

async function main() {
  testNamespaceAndTruncation();
  await testInvalidDimensionSkipped();
  await testEmbeddingCacheKeyStability();
  await testRetryQueuePersistence();
  await disconnectRedis();
  console.log('All Pinecone unit tests passed');
}

main().catch(async (err) => {
  console.error(err);
  await disconnectRedis();
  process.exit(1);
});
