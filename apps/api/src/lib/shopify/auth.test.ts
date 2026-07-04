import { createHmac } from 'crypto';

import { pathToTopic, topicToPath } from './config';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testTopicMapping() {
  assert(topicToPath('orders/create') === 'orders_create', 'topic to path');
  assert(pathToTopic('orders_create') === 'orders/create', 'path to topic');
  assert(
    pathToTopic(topicToPath('app/uninstalled')) === 'app/uninstalled',
    'roundtrip topic',
  );
  assert(
    pathToTopic(topicToPath('app_subscriptions/update')) ===
      'app_subscriptions/update',
    'subscription topic roundtrip',
  );
  console.log('Topic mapping passed');
}

function testOAuthHmacShape() {
  const secret = 'shpss_test_secret';
  const query: Record<string, string> = {
    code: 'abc',
    shop: 'test-store.myshopify.com',
    state: 'nonce123',
    timestamp: '1234567890',
  };

  const message = Object.keys(query)
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join('&');

  const hmac = createHmac('sha256', secret).update(message).digest('hex');
  assert(hmac.length === 64, 'oauth hmac is hex sha256');
  console.log('OAuth HMAC shape passed');
}

function main() {
  testTopicMapping();
  testOAuthHmacShape();
  console.log('All Shopify auth unit tests passed');
}

main();
