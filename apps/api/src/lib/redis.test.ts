import {
  checkRateLimit,
  connectRedis,
  conversationChannel,
  createSession,
  deleteSession,
  disconnectRedis,
  get,
  getSession,
  publish,
  set,
  subscribe,
  unsubscribe,
  updateSession,
} from './redis';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testSessions() {
  const sessionId = `test-session-${Date.now()}`;
  const data = {
    merchantId: 'merchant-1',
    shopDomain: 'test-store.myshopify.com',
    userId: 'user-1',
    createdAt: Date.now(),
  };

  await createSession(sessionId, data, 60);
  const loaded = await getSession(sessionId);
  assert(
    loaded?.merchantId === data.merchantId,
    'getSession should return data',
  );

  await updateSession(sessionId, { userId: 'user-2' });
  const updated = await getSession(sessionId);
  assert(updated?.userId === 'user-2', 'updateSession should merge fields');

  await deleteSession(sessionId);
  const deleted = await getSession(sessionId);
  assert(deleted === null, 'deleteSession should remove session');

  const expiredId = `expired-session-${Date.now()}`;
  await createSession(expiredId, data, 1);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await getSession(expiredId);
  assert(expired === null, 'session should expire after TTL');

  console.log('Session CRUD + TTL passed');
}

async function testRateLimit() {
  const key = `ratelimit:merchant-test:/api/test-${Date.now()}`;

  for (let i = 0; i < 100; i += 1) {
    const result = await checkRateLimit(key, 100, 60);
    assert(result.allowed, `request ${i + 1} should be allowed`);
  }

  const blocked = await checkRateLimit(key, 100, 60);
  assert(!blocked.allowed, 'request 101 should be blocked');
  assert(blocked.remaining === 0, 'remaining should be 0 when blocked');

  const shortKey = `ratelimit:merchant-test:/api/short-${Date.now()}`;
  await checkRateLimit(shortKey, 1, 1);
  const limited = await checkRateLimit(shortKey, 1, 1);
  assert(!limited.allowed, 'should block within window');

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const afterWindow = await checkRateLimit(shortKey, 1, 1);
  assert(afterWindow.allowed, 'should allow after window resets');

  console.log('Rate limit passed');
}

async function testPubSub() {
  const channel = conversationChannel(`conv-${Date.now()}`);
  const payload = { type: 'message.created', id: 'msg-1' };

  let resolveMessage: (message: object) => void;
  const receivedPromise = new Promise<object>((resolve) => {
    resolveMessage = resolve;
  });

  await subscribe(channel, (message) => {
    resolveMessage(message);
  });

  // Allow subscription to settle on the subscriber connection
  await new Promise((resolve) => setTimeout(resolve, 50));

  const startedAt = Date.now();
  await publish(channel, payload);
  const received = await receivedPromise;
  const elapsedMs = Date.now() - startedAt;

  assert(
    (received as { id?: string }).id === payload.id,
    'pub/sub should deliver message payload',
  );
  assert(
    elapsedMs < 100,
    `pub/sub should deliver in <100ms (took ${elapsedMs}ms)`,
  );

  await unsubscribe(channel);
  console.log(`Pub/sub delivered in ${elapsedMs}ms`);
}

async function testCache() {
  const key = `test-cache-${Date.now()}`;
  await set(key, { hello: 'world' }, 60);
  const value = await get<{ hello: string }>(key);
  assert(value?.hello === 'world', 'cache get should return set value');
  console.log('Cache helpers passed');
}

async function main() {
  await connectRedis();

  try {
    await testSessions();
    await testRateLimit();
    await testPubSub();
    await testCache();
    console.log('All Redis tests passed');
  } finally {
    await disconnectRedis();
  }
}

main().catch(async (err) => {
  console.error(err);
  await disconnectRedis();
  process.exit(1);
});
