import { createHash } from 'crypto';

import OpenAI from 'openai';

import { get, set } from '@/lib/redis';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSION = 3072;
const MAX_EMBEDDING_TOKENS = 8000;
/** Approximate chars-per-token for truncation before embedding. */
const CHARS_PER_TOKEN = 4;
const MAX_EMBEDDING_CHARS = MAX_EMBEDDING_TOKENS * CHARS_PER_TOKEN;
const CACHE_TTL_SECONDS = 60 * 60;
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 60_000;

const globalForOpenAI = globalThis as unknown as {
  novaOpenAI?: OpenAI;
};

function getOpenAI(): OpenAI {
  if (!globalForOpenAI.novaOpenAI) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    globalForOpenAI.novaOpenAI = new OpenAI({ apiKey });
  }
  return globalForOpenAI.novaOpenAI;
}

function embeddingCacheKey(text: string): string {
  const hash = createHash('sha256').update(text).digest('hex');
  return `embedding:${EMBEDDING_MODEL}:${hash}`;
}

export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBEDDING_CHARS) {
    return text;
  }
  return text.slice(0, MAX_EMBEDDING_CHARS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as {
    status?: number;
    code?: string;
    message?: string;
  };

  return (
    err.status === 429 ||
    err.code === 'rate_limit_exceeded' ||
    Boolean(err.message?.toLowerCase().includes('rate limit'))
  );
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s... capped at 60s
  return Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

async function createEmbeddingWithRetry(text: string): Promise<number[]> {
  const client = getOpenAI();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIMENSION,
      });

      const values = response.data[0]?.embedding;
      if (!values) {
        throw new Error('OpenAI embedding response missing vector values');
      }

      return values;
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const delay = isRateLimitError(error)
        ? backoffMs(attempt)
        : Math.min(200 * 2 ** (attempt - 1), 2000);

      console.warn(
        `[embedding] attempt ${attempt} failed, retrying in ${delay}ms`,
        error instanceof Error ? error.message : error,
      );

      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to generate embedding');
}

/**
 * Generates a text-embedding-3-large vector, with Redis caching and retries.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = truncateForEmbedding(text);
  const cacheKey = embeddingCacheKey(truncated);

  const cached = await get<{ values: number[] }>(cacheKey);
  if (cached?.values?.length) {
    return cached.values;
  }

  const values = await createEmbeddingWithRetry(truncated);

  await set(cacheKey, { values }, CACHE_TTL_SECONDS);

  return values;
}

export const EMBEDDING_DIMENSION_SIZE = EMBEDDING_DIMENSION;
