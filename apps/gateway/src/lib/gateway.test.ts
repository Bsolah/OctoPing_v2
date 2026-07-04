import { handlePreflight, isAllowedOrigin } from './cors';
import { resolveBackendPath } from './proxy';
import { verifyShopifyWebhookHmac } from './shopify';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function hmacSign(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, body);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function testProxyPaths() {
  assert(
    resolveBackendPath(['conversations', '123']) === '/conversations/123',
    'conversations path rewrite',
  );
  assert(resolveBackendPath(['ai', 'chat']) === '/ai/chat', 'ai path rewrite');
  assert(
    resolveBackendPath(['analytics', 'overview']) === '/analytics/overview',
    'analytics path rewrite',
  );
  assert(
    resolveBackendPath(['knowledge-base']) === '/knowledge-base',
    'knowledge-base path rewrite',
  );
  assert(resolveBackendPath(['unknown']) === null, 'unknown path rejected');
  console.log('Proxy path rewriting passed');
}

function testCors() {
  process.env.SHOPIFY_APP_URL = 'https://app.nova-support.test';
  process.env.MERCHANT_DOMAINS = 'https://partner.example.com';

  assert(
    isAllowedOrigin('https://app.nova-support.test'),
    'app origin allowed',
  );
  assert(
    isAllowedOrigin('https://partner.example.com'),
    'merchant domain allowed',
  );
  assert(isAllowedOrigin('https://admin.shopify.com'), 'shopify admin allowed');
  assert(
    isAllowedOrigin('https://test-store.myshopify.com'),
    'myshopify origin allowed',
  );
  assert(
    !isAllowedOrigin('https://evil.example.com'),
    'unknown origin blocked',
  );

  const allowed = handlePreflight(
    new Request('https://gateway.test/v1/conversations', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.nova-support.test' },
    }),
  );
  assert(allowed?.status === 204, 'preflight returns 204 for allowed origin');

  const blocked = handlePreflight(
    new Request('https://gateway.test/v1/conversations', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com' },
    }),
  );
  assert(blocked?.status === 403, 'preflight returns 403 for blocked origin');

  console.log('CORS preflight passed');
}

async function testWebhookHmac() {
  process.env.SHOPIFY_API_SECRET = 'test-shopify-secret';
  const body = new TextEncoder().encode('{"id":1}').buffer;
  const validHmac = await hmacSign('test-shopify-secret', body);

  assert(
    await verifyShopifyWebhookHmac(body, validHmac),
    'valid HMAC accepted',
  );
  assert(
    !(await verifyShopifyWebhookHmac(body, 'invalid')),
    'invalid HMAC rejected',
  );
  assert(
    !(await verifyShopifyWebhookHmac(body, null)),
    'missing HMAC rejected',
  );

  console.log('Webhook HMAC verification passed');
}

async function main() {
  testProxyPaths();
  testCors();
  await testWebhookHmac();
  console.log('All gateway unit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
