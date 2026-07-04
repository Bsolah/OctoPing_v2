import { createHmac, timingSafeEqual } from 'crypto';

import bcrypt from 'bcrypt';

import { decrypt, encrypt } from '@/lib/encryption';

const BCRYPT_ROUNDS = 12;

/**
 * Encrypts PII at rest (AES-256-GCM via ENCRYPTION_KEY).
 */
export function encryptPII(data: string): string {
  return encrypt(data);
}

/**
 * Decrypts PII produced by encryptPII().
 */
export function decryptPII(encrypted: string): string {
  return decrypt(encrypted);
}

/**
 * One-way hash for passwords / opaque tokens (bcrypt).
 */
export async function hashSensitive(data: string): Promise<string> {
  return bcrypt.hash(data, BCRYPT_ROUNDS);
}

export async function verifySensitive(
  data: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(data, hash);
}

/**
 * Masks an email for display/logs: j***@example.com
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) {
    return '***';
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

/**
 * Masks a phone number for display/logs: ***-***-1234
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***';
  }

  const last4 = digits.slice(-4);
  return `***-***-${last4}`;
}

/**
 * Strips common XSS vectors from untrusted input.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/&#x?[0-9a-f]+;?/gi, '')
    .trim();
}

/**
 * Constant-time HMAC-SHA256 verification (hex or base64 digest).
 */
export function validateWebhookHMAC(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedHex = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  const expectedB64 = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64');

  return (
    hmacDigestMatches(signature, expectedHex) ||
    hmacDigestMatches(signature, expectedB64)
  );
}

function hmacDigestMatches(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/** Patterns that indicate injection / traversal attempts. */
export const SUSPICIOUS_PATTERNS: RegExp[] = [
  /('\s*or\s*'?\d|' or 1=1|--\s*$|or\s+1\s*=\s*1)/i,
  /union(\s|\+)+select/i,
  /insert(\s|\+)+into/i,
  /drop(\s|\+)+table/i,
  /delete(\s|\+)+from/i,
  /;\s*shutdown/i,
  /exec(\s|\+)+(s|x)p\w+/i,
  /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.%2e\/|%2e\.\/)/i,
  /\/etc\/passwd/i,
  /\/proc\/self/i,
  /<script\b/i,
];

export function detectSuspiciousInput(value: string): string | null {
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(value)) {
      return pattern.source;
    }
  }
  return null;
}

export function detectSuspiciousRequest(parts: string[]): string | null {
  for (const part of parts) {
    const hit = detectSuspiciousInput(part);
    if (hit) {
      return hit;
    }
  }
  return null;
}
