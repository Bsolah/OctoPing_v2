import { getShopifyApiSecret } from './config';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i)! ^ b.charCodeAt(i)!;
  }
  return mismatch === 0;
}

/**
 * Verifies Shopify webhook HMAC-SHA256 (base64) from X-Shopify-Hmac-Sha256.
 */
export async function verifyShopifyWebhookHmac(
  rawBody: ArrayBuffer,
  hmacHeader: string | null,
): Promise<boolean> {
  if (!hmacHeader) {
    return false;
  }

  const secret = getShopifyApiSecret();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, rawBody);
  const digest = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return timingSafeEqual(digest, hmacHeader);
}
