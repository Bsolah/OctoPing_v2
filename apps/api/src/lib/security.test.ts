import {
  decryptPII,
  detectSuspiciousInput,
  encryptPII,
  hashSensitive,
  maskEmail,
  maskPhone,
  sanitizeInput,
  validateWebhookHMAC,
  verifySensitive,
} from './security';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const secret = 'test-webhook-secret';
  const payload = '{"id":1}';

  // PII encryption roundtrip
  const encrypted = encryptPII('customer@example.com');
  assert(encrypted !== 'customer@example.com', 'PII must be encrypted');
  assert(!encrypted.includes('customer@example.com'), 'ciphertext hides email');
  assert(decryptPII(encrypted) === 'customer@example.com', 'PII decrypts');

  // bcrypt
  const hash = await hashSensitive('super-secret-token');
  assert(hash !== 'super-secret-token', 'hash is not plaintext');
  assert(await verifySensitive('super-secret-token', hash), 'hash verifies');

  // Masking
  assert(
    maskEmail('jane.doe@example.com') === 'j***@example.com',
    'mask email',
  );
  assert(maskPhone('+1 (555) 123-9876') === '***-***-9876', 'mask phone');

  // XSS sanitization
  const xss = sanitizeInput('<script>alert(1)</script>Hello');
  assert(!xss.toLowerCase().includes('<script'), 'script tags removed');
  assert(xss.includes('Hello'), 'safe text retained');

  // SQL injection detection
  const sqli = detectSuspiciousInput("' OR 1=1 --");
  assert(sqli !== null, 'SQL injection pattern detected');

  const traversal = detectSuspiciousInput('../../etc/passwd');
  assert(traversal !== null, 'path traversal detected');

  // Webhook HMAC
  const { createHmac } = await import('crypto');
  const signature = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64');
  assert(
    validateWebhookHMAC(payload, signature, secret),
    'valid HMAC accepted',
  );
  assert(
    !validateWebhookHMAC(payload, 'invalid', secret),
    'invalid HMAC rejected',
  );

  console.log('All security tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
