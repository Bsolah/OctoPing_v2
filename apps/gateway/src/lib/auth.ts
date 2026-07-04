import { getGatewayApiKey, getShopifyApiSecret } from './config';

export type AuthResult =
  | { ok: true; subject: string; method: 'api_key' | 'session_token' }
  | { ok: false; status: number; message: string };

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function verifyHs256Jwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const expected = bytesToBase64Url(signature);

  if (expected !== signatureB64) {
    return null;
  }

  try {
    const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      return null;
    }
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Accepts either:
 * - Authorization: Bearer <shopify-session-token>
 * - Authorization: Bearer <GATEWAY_API_KEY> / X-API-Key: <GATEWAY_API_KEY>
 */
export async function authenticateRequest(
  request: Request,
): Promise<AuthResult> {
  const apiKeyHeader = request.headers.get('x-api-key');
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;

  const configuredApiKey = getGatewayApiKey();
  const presentedApiKey = apiKeyHeader ?? bearer;

  if (configuredApiKey && presentedApiKey === configuredApiKey) {
    return { ok: true, subject: 'api-key', method: 'api_key' };
  }

  if (!bearer) {
    return {
      ok: false,
      status: 401,
      message: 'Missing or invalid Authorization header',
    };
  }

  try {
    const secret = getShopifyApiSecret();
    const payload = await verifyHs256Jwt(bearer, secret);
    if (!payload) {
      return {
        ok: false,
        status: 401,
        message: 'Invalid or expired session token',
      };
    }

    const subject =
      (typeof payload.dest === 'string' && payload.dest) ||
      (typeof payload.sub === 'string' && payload.sub) ||
      'session';

    return { ok: true, subject, method: 'session_token' };
  } catch {
    return {
      ok: false,
      status: 401,
      message: 'Authentication failed',
    };
  }
}
