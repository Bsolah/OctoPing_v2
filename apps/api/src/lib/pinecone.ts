import {
  Pinecone,
  type Index,
  type RecordMetadata,
} from '@pinecone-database/pinecone';
import type {
  KnowledgeBaseEntry,
  PineconeVectorMetadata,
  SearchResult,
} from '@nova/shared';

import { getRedis } from '@/lib/redis';
import {
  EMBEDDING_DIMENSION_SIZE,
  generateEmbedding,
} from '@/services/embedding';

const INDEX_DIMENSION = 3072;
const UPSERT_BATCH_SIZE = 100;
const EMBEDDING_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const RETRY_QUEUE_KEY = 'pinecone:retry-queue';
const DEFAULT_TOP_K = 5;

export type VectorRecord = {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
};

export type QueryVectorsOptions = {
  vector: number[];
  filter?: object;
  topK: number;
  namespace: string;
};

export type QueryVectorMatch = {
  id: string;
  score: number;
  metadata: object;
};

export type SearchKnowledgeBaseOptions = {
  merchantId: string;
  query: string;
  contentType?: string;
  topK?: number;
};

type RetryQueueItem = {
  operation: 'upsert';
  namespace: string;
  vectors: VectorRecord[];
  enqueuedAt: number;
  attempts: number;
};

const globalForPinecone = globalThis as unknown as {
  novaPinecone?: Pinecone;
  novaPineconeIndex?: Index<RecordMetadata>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey(): string {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error('PINECONE_API_KEY environment variable is required');
  }
  return apiKey;
}

function getIndexName(): string {
  return process.env.PINECONE_INDEX_NAME ?? 'nova-support-kb';
}

export function merchantNamespace(merchantId: string): string {
  return `merchant-${merchantId}`;
}

function getPinecone(): Pinecone {
  if (!globalForPinecone.novaPinecone) {
    globalForPinecone.novaPinecone = new Pinecone({ apiKey: getApiKey() });
  }
  return globalForPinecone.novaPinecone;
}

function getIndex(): Index<RecordMetadata> {
  if (!globalForPinecone.novaPineconeIndex) {
    globalForPinecone.novaPineconeIndex = getPinecone().index(getIndexName());
  }
  return globalForPinecone.novaPineconeIndex;
}

async function withPineconeRetry<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const delay = Math.min(200 * 2 ** (attempt - 1), 2000);
      console.warn(
        `[pinecone] ${operation} attempt ${attempt} failed, retrying in ${delay}ms`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Pinecone ${operation} failed after ${MAX_RETRIES} retries`);
}

function isValidDimension(values: number[]): boolean {
  return values.length === INDEX_DIMENSION;
}

function toPineconeMetadata(metadata: Record<string, unknown>): RecordMetadata {
  const result: RecordMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      result[key] = value;
    } else if (value != null) {
      result[key] = JSON.stringify(value);
    }
  }

  return result;
}

async function enqueueRetry(item: RetryQueueItem): Promise<void> {
  await getRedis().rpush(RETRY_QUEUE_KEY, JSON.stringify(item));
  console.warn(
    `[pinecone] queued ${item.vectors.length} vectors for retry in namespace ${item.namespace}`,
  );
}

/**
 * Verifies Pinecone connectivity and index dimension on startup.
 */
export async function connectPinecone(): Promise<void> {
  const index = getIndex();
  const stats = await withPineconeRetry('describeIndexStats', () =>
    index.describeIndexStats(),
  );

  const dimension = stats.dimension;
  if (dimension != null && dimension !== INDEX_DIMENSION) {
    throw new Error(
      `Pinecone index dimension mismatch: expected ${INDEX_DIMENSION}, got ${dimension}`,
    );
  }

  console.info(
    `[pinecone] connected to index "${getIndexName()}" (dimension=${dimension ?? INDEX_DIMENSION})`,
  );
}

export async function isPineconeHealthy(): Promise<boolean> {
  try {
    await getIndex().describeIndexStats();
    return true;
  } catch {
    return false;
  }
}

export async function upsertVectors(vectors: VectorRecord[]): Promise<void> {
  if (vectors.length === 0) {
    return;
  }

  const byNamespace = new Map<string, VectorRecord[]>();

  for (const vector of vectors) {
    const metadata = vector.metadata as PineconeVectorMetadata;
    const namespace = merchantNamespace(metadata.merchantId);

    if (!isValidDimension(vector.values)) {
      console.error(
        `[pinecone] invalid dimension for vector ${vector.id}: expected ${INDEX_DIMENSION}, got ${vector.values.length}; skipping`,
      );
      continue;
    }

    const bucket = byNamespace.get(namespace) ?? [];
    bucket.push(vector);
    byNamespace.set(namespace, bucket);
  }

  for (const [namespace, namespaceVectors] of byNamespace) {
    for (let i = 0; i < namespaceVectors.length; i += UPSERT_BATCH_SIZE) {
      const batch = namespaceVectors.slice(i, i + UPSERT_BATCH_SIZE);

      try {
        await withPineconeRetry('upsert', () =>
          getIndex()
            .namespace(namespace)
            .upsert(
              batch.map((vector) => ({
                id: vector.id,
                values: vector.values,
                metadata: toPineconeMetadata(vector.metadata),
              })),
            ),
        );
      } catch (error) {
        await enqueueRetry({
          operation: 'upsert',
          namespace,
          vectors: batch,
          enqueuedAt: Date.now(),
          attempts: MAX_RETRIES,
        });
        throw error;
      }
    }
  }
}

export async function queryVectors(
  options: QueryVectorsOptions,
): Promise<QueryVectorMatch[]> {
  const { vector, filter, topK, namespace } = options;

  if (!isValidDimension(vector)) {
    console.error(
      `[pinecone] invalid query dimension: expected ${INDEX_DIMENSION}, got ${vector.length}; skipping`,
    );
    return [];
  }

  const response = await withPineconeRetry('query', () =>
    getIndex()
      .namespace(namespace)
      .query({
        vector,
        topK,
        includeMetadata: true,
        ...(filter ? { filter } : {}),
      }),
  );

  return (response.matches ?? []).map((match) => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: (match.metadata ?? {}) as object,
  }));
}

export async function deleteVectors(
  ids: string[],
  namespace: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await withPineconeRetry('deleteMany', () =>
    getIndex().namespace(namespace).deleteMany(ids),
  );
}

export async function deleteNamespace(namespace: string): Promise<void> {
  await withPineconeRetry('deleteAll', () =>
    getIndex().namespace(namespace).deleteAll(),
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<
  Array<
    { status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown }
  >
> {
  const results: Array<
    { status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown }
  > = new Array(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item === undefined) {
        continue;
      }

      try {
        const value = await worker(item, current);
        results[current] = { status: 'fulfilled', value };
      } catch (reason) {
        results[current] = { status: 'rejected', reason };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);

  return results;
}

function buildVectorMetadata(
  entry: KnowledgeBaseEntry,
): PineconeVectorMetadata {
  return {
    merchantId: entry.merchantId,
    contentType: entry.contentType,
    title: entry.title,
    sourceId: entry.id,
    content: entry.content,
    ...(entry.metadata ?? {}),
  };
}

/**
 * Embeds a knowledge base entry and upserts it into the merchant namespace.
 */
export async function syncKnowledgeBaseEntry(
  entry: KnowledgeBaseEntry,
): Promise<void> {
  const text = `${entry.title}\n\n${entry.content}`;
  const values = await generateEmbedding(text);

  if (!isValidDimension(values)) {
    console.error(
      `[pinecone] invalid embedding dimension for entry ${entry.id}; skipping`,
    );
    return;
  }

  await upsertVectors([
    {
      id: entry.id,
      values,
      metadata: buildVectorMetadata(entry),
    },
  ]);
}

/**
 * Batch-syncs knowledge base entries (embed ≤10 concurrent, upsert ≤100).
 * Per-item failures are logged and do not fail the entire batch.
 */
export async function batchSyncKnowledgeBase(
  entries: KnowledgeBaseEntry[],
): Promise<{ succeeded: number; failed: number }> {
  if (entries.length === 0) {
    return { succeeded: 0, failed: 0 };
  }

  const embedResults = await mapPool(
    entries,
    EMBEDDING_CONCURRENCY,
    async (entry) => {
      const text = `${entry.title}\n\n${entry.content}`;
      const values = await generateEmbedding(text);

      if (!isValidDimension(values)) {
        throw new Error(
          `Invalid embedding dimension for entry ${entry.id}: ${values.length}`,
        );
      }

      return {
        id: entry.id,
        values,
        metadata: buildVectorMetadata(entry),
      } satisfies VectorRecord;
    },
  );

  const vectors: VectorRecord[] = [];
  let failed = 0;
  let succeeded = 0;

  for (let i = 0; i < embedResults.length; i += 1) {
    const result = embedResults[i];
    const entry = entries[i];

    if (!result || result.status === 'rejected') {
      failed += 1;
      console.error(
        `[pinecone] failed to embed entry ${entry?.id ?? i}`,
        result && result.status === 'rejected'
          ? result.reason
          : 'unknown error',
      );
      continue;
    }

    vectors.push(result.value);
  }

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);

    try {
      await upsertVectors(batch);
      succeeded += batch.length;
    } catch (error) {
      // Downtime path: vectors already queued inside upsertVectors.
      // Count batch as failed but continue remaining batches.
      failed += batch.length;
      console.error(
        `[pinecone] failed to upsert batch starting at ${i}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { succeeded, failed };
}

/**
 * Semantic search over a merchant's knowledge base namespace.
 */
export async function searchKnowledgeBase(
  options: SearchKnowledgeBaseOptions,
): Promise<SearchResult[]> {
  const { merchantId, query, contentType, topK = DEFAULT_TOP_K } = options;
  const vector = await generateEmbedding(query);
  const namespace = merchantNamespace(merchantId);

  const filter = contentType
    ? {
        contentType: { $eq: contentType },
        merchantId: { $eq: merchantId },
      }
    : {
        merchantId: { $eq: merchantId },
      };

  const matches = await queryVectors({
    vector,
    filter,
    topK,
    namespace,
  });

  return matches.map((match) => {
    const metadata = match.metadata as PineconeVectorMetadata;

    return {
      id: match.id,
      score: match.score,
      title: typeof metadata.title === 'string' ? metadata.title : '',
      content: typeof metadata.content === 'string' ? metadata.content : '',
      metadata: { ...metadata },
    };
  });
}

/**
 * Replays upserts that failed while Pinecone was unavailable.
 */
export async function processPineconeRetryQueue(): Promise<number> {
  const redis = getRedis();
  let processed = 0;
  let raw = await redis.lpop(RETRY_QUEUE_KEY);

  while (raw) {
    const item = JSON.parse(raw) as RetryQueueItem;

    try {
      await withPineconeRetry('retry-upsert', () =>
        getIndex()
          .namespace(item.namespace)
          .upsert(
            item.vectors.map((vector) => ({
              id: vector.id,
              values: vector.values,
              metadata: toPineconeMetadata(vector.metadata),
            })),
          ),
      );
      processed += item.vectors.length;
    } catch (error) {
      await redis.rpush(
        RETRY_QUEUE_KEY,
        JSON.stringify({
          ...item,
          attempts: item.attempts + 1,
          enqueuedAt: Date.now(),
        }),
      );
      console.error(
        '[pinecone] retry queue item failed; re-queued',
        error instanceof Error ? error.message : error,
      );
      break;
    }

    raw = await redis.lpop(RETRY_QUEUE_KEY);
  }

  return processed;
}

export { INDEX_DIMENSION, EMBEDDING_DIMENSION_SIZE, RETRY_QUEUE_KEY };
