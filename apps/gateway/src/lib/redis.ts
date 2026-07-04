import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

/**
 * Upstash REST client for Edge runtime.
 * Uses REDIS_URL + REDIS_TOKEN (or UPSTASH_REDIS_REST_* aliases).
 */
export function getRedis(): Redis {
  if (redis) {
    return redis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? '';

  if (!url || !token) {
    throw new Error(
      'Redis REST credentials required (REDIS_URL + REDIS_TOKEN or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)',
    );
  }

  redis = new Redis({ url, token });
  return redis;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const result = await getRedis().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
