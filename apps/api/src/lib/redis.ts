import Redis from 'ioredis';

const SESSION_PREFIX = 'session:';
const CACHE_PREFIX = 'cache:';
const RATE_LIMIT_PREFIX = 'ratelimit:';
const MAX_RETRIES = 3;

export type SessionData = {
  merchantId: string;
  shopDomain: string;
  userId?: string;
  createdAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type MessageHandler = (message: object) => void;

const globalForRedis = globalThis as unknown as {
  novaRedis?: Redis;
  novaRedisSubscriber?: Redis;
  novaRedisHandlers?: Map<string, Set<MessageHandler>>;
  novaRedisShutdownRegistered?: boolean;
};

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is required');
  }
  return url;
}

function createRedisClient(label: string): Redis {
  const client = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: MAX_RETRIES,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > MAX_RETRIES) {
        return null;
      }
      // Exponential backoff: 200ms, 400ms, 800ms
      return Math.min(200 * 2 ** (times - 1), 2000);
    },
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error(`[redis:${label}]`, err.message);
  });

  return client;
}

function getHandlers(): Map<string, Set<MessageHandler>> {
  if (!globalForRedis.novaRedisHandlers) {
    globalForRedis.novaRedisHandlers = new Map();
  }
  return globalForRedis.novaRedisHandlers;
}

export function getRedis(): Redis {
  if (!globalForRedis.novaRedis) {
    globalForRedis.novaRedis = createRedisClient('main');
  }
  return globalForRedis.novaRedis;
}

function getSubscriber(): Redis {
  if (!globalForRedis.novaRedisSubscriber) {
    const subscriber = createRedisClient('subscriber');

    subscriber.on('message', (channel, payload) => {
      const handlers = getHandlers().get(channel);
      if (!handlers) {
        return;
      }

      let message: object;
      try {
        message = JSON.parse(payload) as object;
      } catch {
        message = { raw: payload };
      }

      for (const handler of handlers) {
        handler(message);
      }
    });

    globalForRedis.novaRedisSubscriber = subscriber;
  }

  return globalForRedis.novaRedisSubscriber;
}

function registerProcessShutdown(): void {
  if (globalForRedis.novaRedisShutdownRegistered) {
    return;
  }

  process.once('beforeExit', () => {
    void disconnectRedis();
  });

  globalForRedis.novaRedisShutdownRegistered = true;
}

/**
 * Connects the Redis client and runs a health-check PING.
 */
export async function connectRedis(): Promise<void> {
  const redis = getRedis();

  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }

  const pong = await redis.ping();
  if (pong !== 'PONG') {
    throw new Error(`Redis health check failed: expected PONG, got ${pong}`);
  }

  registerProcessShutdown();
}

export async function disconnectRedis(): Promise<void> {
  const quitClient = async (client: Redis | undefined) => {
    if (!client) {
      return;
    }
    if (client.status === 'end' || client.status === 'close') {
      return;
    }
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };

  await quitClient(globalForRedis.novaRedisSubscriber);
  await quitClient(globalForRedis.novaRedis);

  globalForRedis.novaRedisSubscriber = undefined;
  globalForRedis.novaRedis = undefined;
  globalForRedis.novaRedisHandlers = undefined;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status !== 'ready') {
      return false;
    }
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

function cacheKey(key: string): string {
  return key.startsWith(CACHE_PREFIX) ? key : `${CACHE_PREFIX}${key}`;
}

function rateLimitKey(key: string): string {
  return key.startsWith(RATE_LIMIT_PREFIX) ? key : `${RATE_LIMIT_PREFIX}${key}`;
}

// --- Session store ---

export async function createSession(
  sessionId: string,
  data: SessionData,
  ttlSeconds: number,
): Promise<void> {
  await getRedis().set(
    sessionKey(sessionId),
    JSON.stringify(data),
    'EX',
    ttlSeconds,
  );
}

export async function getSession(
  sessionId: string,
): Promise<SessionData | null> {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as SessionData;
}

export async function updateSession(
  sessionId: string,
  data: Partial<SessionData>,
): Promise<void> {
  const redis = getRedis();
  const key = sessionKey(sessionId);
  const existing = await getSession(sessionId);

  if (!existing) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const ttl = await redis.ttl(key);
  const updated: SessionData = { ...existing, ...data };

  if (ttl > 0) {
    await redis.set(key, JSON.stringify(updated), 'EX', ttl);
  } else {
    await redis.set(key, JSON.stringify(updated));
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getRedis().del(sessionKey(sessionId));
}

// --- Rate limiter (fixed window via INCR + EXPIRE) ---

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const redisKey = rateLimitKey(key);

  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  let ttl = await redis.ttl(redisKey);
  if (ttl < 0) {
    await redis.expire(redisKey, windowSeconds);
    ttl = windowSeconds;
  }

  const resetAt = Date.now() + ttl * 1000;

  return {
    allowed: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt,
  };
}

// --- Pub/Sub ---

export async function publish(channel: string, message: object): Promise<void> {
  await getRedis().publish(channel, JSON.stringify(message));
}

export async function subscribe(
  channel: string,
  handler: MessageHandler,
): Promise<void> {
  const subscriber = getSubscriber();
  const handlers = getHandlers();

  if (subscriber.status === 'wait' || subscriber.status === 'end') {
    await subscriber.connect();
  }

  let channelHandlers = handlers.get(channel);
  if (!channelHandlers) {
    channelHandlers = new Set();
    handlers.set(channel, channelHandlers);
    await subscriber.subscribe(channel);
  }

  channelHandlers.add(handler);
}

export async function unsubscribe(channel: string): Promise<void> {
  const handlers = getHandlers();
  handlers.delete(channel);

  const subscriber = globalForRedis.novaRedisSubscriber;
  if (subscriber && subscriber.status === 'ready') {
    await subscriber.unsubscribe(channel);
  }
}

export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function merchantAgentsChannel(merchantId: string): string {
  return `merchant:${merchantId}:agents`;
}

// --- Cache helpers ---

export async function get<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(cacheKey(key));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
}

export async function set(
  key: string,
  value: object,
  ttlSeconds: number,
): Promise<void> {
  await getRedis().set(cacheKey(key), JSON.stringify(value), 'EX', ttlSeconds);
}

export async function del(key: string): Promise<void> {
  await getRedis().del(cacheKey(key));
}
