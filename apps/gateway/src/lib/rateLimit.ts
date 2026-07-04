import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS } from './config';
import { getRedis } from './redis';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

export async function checkRateLimit(
  key: string,
  maxRequests = RATE_LIMIT_MAX,
  windowSeconds = RATE_LIMIT_WINDOW_SECONDS,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const redisKey = key.startsWith('ratelimit:') ? key : `ratelimit:${key}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  let ttl = await redis.ttl(redisKey);
  if (ttl < 0) {
    await redis.expire(redisKey, windowSeconds);
    ttl = windowSeconds;
  }

  return {
    allowed: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt: Date.now() + ttl * 1000,
    limit: maxRequests,
  };
}

export function rateLimitKeyFromRequest(
  request: Request,
  subject: string,
): string {
  const url = new URL(request.url);
  const endpoint = url.pathname;
  return `ratelimit:gateway:${subject}:${endpoint}`;
}
