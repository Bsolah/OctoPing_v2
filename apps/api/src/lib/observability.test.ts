import {
  getLangChainCallbackConfig,
  getObservabilityStatus,
  initObservability,
  redactPiiString,
  redactPiiValue,
} from './observability';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testPiiRedaction() {
  const text =
    'Contact jane.doe@example.com or +1 555-123-4567 at 123 Main Street';
  const redacted = redactPiiString(text);

  assert(!redacted.includes('jane.doe@example.com'), 'email redacted');
  assert(!redacted.includes('555-123-4567'), 'phone redacted');
  assert(redacted.includes('[REDACTED_EMAIL]'), 'email placeholder present');

  const payload = redactPiiValue({
    email: 'user@shop.com',
    phone: '555-000-1111',
    note: 'Ship to 42 Oak Avenue',
    nested: { token: 'secret-token', ok: true },
  }) as Record<string, unknown>;

  assert(payload.email === '[REDACTED]', 'email field redacted');
  assert(payload.phone === '[REDACTED]', 'phone field redacted');
  assert(
    (payload.nested as { token: string }).token === '[REDACTED]',
    'token field redacted',
  );

  console.log('PII redaction passed');
}

function testInitWithoutKeys() {
  delete process.env.DATADOG_API_KEY;
  delete process.env.DD_API_KEY;
  delete process.env.SENTRY_DSN;
  delete process.env.LANGSMITH_API_KEY;

  initObservability();
  const status = getObservabilityStatus();

  assert(status.datadog === false, 'datadog disabled without key');
  assert(status.sentry === false, 'sentry disabled without dsn');
  assert(status.langsmith === false, 'langsmith disabled without key');

  const callbacks = getLangChainCallbackConfig({
    merchantId: 'm1',
    conversationId: 'c1',
    agentType: 'support',
  });

  assert(callbacks.enabled === false, 'callbacks disabled without langsmith');
  assert(
    callbacks.tags.includes('merchant_id:m1'),
    'callback tags include merchant',
  );

  console.log('Observability init without keys passed');
}

function main() {
  testPiiRedaction();
  testInitWithoutKeys();
  console.log('All observability tests passed');
}

main();
