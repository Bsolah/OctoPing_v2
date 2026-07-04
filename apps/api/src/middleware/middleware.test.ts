import Fastify from 'fastify';

import {
  connectRedis,
  createSession,
  deleteSession,
  disconnectRedis,
} from '@/lib/redis';
import rateLimitPlugin from '@/middleware/rateLimit';
import sessionPlugin from '@/middleware/session';
import { healthRoutes } from '@/routes/health';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await connectRedis();

  const app = Fastify({ logger: false });
  await app.register(sessionPlugin);
  await app.register(rateLimitPlugin);
  await app.register(healthRoutes);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const merchantId = `merchant-mw-${runId}`;
  const pingPath = `/api/ping-${runId}`;

  app.get(pingPath, async (request) => ({
    ok: true,
    merchantId: request.session.merchantId,
  }));

  await app.ready();

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert(health.statusCode === 200, 'health should be 200 without auth');
  assert(
    (health.json() as { redis: string }).redis === 'up',
    'health should report redis up',
  );

  const unauthorized = await app.inject({ method: 'GET', url: pingPath });
  assert(unauthorized.statusCode === 401, 'missing auth should be 401');

  const expired = await app.inject({
    method: 'GET',
    url: pingPath,
    headers: { authorization: 'Bearer missing-session' },
  });
  assert(expired.statusCode === 401, 'missing session should be 401');

  const sessionId = `mw-session-${runId}`;
  await createSession(
    sessionId,
    {
      merchantId,
      shopDomain: 'test-store.myshopify.com',
      createdAt: Date.now(),
    },
    60,
  );

  const ok = await app.inject({
    method: 'GET',
    url: pingPath,
    headers: { authorization: `Bearer ${sessionId}` },
  });
  assert(ok.statusCode === 200, 'valid session should be 200');
  assert(
    (ok.json() as { merchantId: string }).merchantId === merchantId,
    'session should attach merchantId',
  );

  let blockedStatus = 0;
  let retryAfter: string | undefined;
  for (let i = 0; i < 101; i += 1) {
    const response = await app.inject({
      method: 'GET',
      url: pingPath,
      headers: { authorization: `Bearer ${sessionId}` },
    });
    if (response.statusCode === 429) {
      blockedStatus = response.statusCode;
      retryAfter = response.headers['retry-after'] as string | undefined;
      break;
    }
  }

  assert(blockedStatus === 429, 'rate limit should return 429');
  assert(Boolean(retryAfter), '429 should include Retry-After header');

  await deleteSession(sessionId);
  await app.close();
  await disconnectRedis();

  console.log('Middleware session + rate limit checks passed');
}

main().catch(async (err) => {
  console.error(err);
  await disconnectRedis();
  process.exit(1);
});
