import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { getRedis } from '@/lib/redis';
import { getLogger } from '@/lib/observability';

import {
  getApiPublicUrl,
  getShopifyApiKey,
  getShopifyApiSecret,
  getShopifyScopes,
  normalizeShopDomain,
  SHOPIFY_API_VERSION,
  topicToPath,
  WEBHOOK_TOPICS,
} from './config';

const NONCE_PREFIX = 'shopify:oauth:nonce:';
const NONCE_TTL_SECONDS = 10 * 60;

function buildHmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Builds the Shopify OAuth authorize URL and stores a nonce in Redis (10 min TTL).
 */
export async function generateAuthUrl(
  shop: string,
  redirectUri: string,
): Promise<string> {
  const shopDomain = normalizeShopDomain(shop);
  const nonce = randomBytes(16).toString('hex');

  await getRedis().set(
    `${NONCE_PREFIX}${nonce}`,
    shopDomain,
    'EX',
    NONCE_TTL_SECONDS,
  );

  const params = new URLSearchParams({
    client_id: getShopifyApiKey(),
    scope: getShopifyScopes(),
    redirect_uri: redirectUri,
    state: nonce,
  });

  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Validates Shopify OAuth callback HMAC and nonce.
 */
export async function validateHmac(
  query: Record<string, string | string[] | undefined>,
): Promise<{ valid: boolean; shop?: string; reason?: string }> {
  const hmac = String(query.hmac ?? '');
  const state = String(query.state ?? '');
  const shop = String(query.shop ?? '');

  if (!hmac || !state || !shop) {
    return { valid: false, reason: 'missing_params' };
  }

  const storedShop = await getRedis().get(`${NONCE_PREFIX}${state}`);
  if (!storedShop) {
    return { valid: false, reason: 'invalid_or_expired_nonce' };
  }

  const shopDomain = normalizeShopDomain(shop);
  if (storedShop !== shopDomain) {
    return { valid: false, reason: 'shop_mismatch' };
  }

  const message = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => {
      const value = query[key];
      const normalized = Array.isArray(value) ? value.join(',') : String(value);
      return `${key}=${normalized}`;
    })
    .join('&');

  const digest = buildHmac(getShopifyApiSecret(), message);
  if (!safeEqualHex(digest, hmac)) {
    return { valid: false, reason: 'invalid_hmac' };
  }

  await getRedis().del(`${NONCE_PREFIX}${state}`);

  return { valid: true, shop: shopDomain };
}

/**
 * Exchanges an authorization code for a permanent access token.
 */
export async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<{ accessToken: string; scope: string }> {
  const shopDomain = normalizeShopDomain(shop);
  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: getShopifyApiKey(),
        client_secret: getShopifyApiSecret(),
        code,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    getLogger().error(
      { shop: shopDomain, status: response.status },
      'Shopify token exchange failed',
    );
    throw new Error(`Token exchange failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    scope: string;
  };

  return { accessToken: data.access_token, scope: data.scope };
}

/**
 * Registers required webhooks for the shop.
 */
export async function registerWebhooks(
  shop: string,
  accessToken: string,
): Promise<void> {
  const shopDomain = normalizeShopDomain(shop);
  const baseUrl = getApiPublicUrl();
  const log = getLogger();

  for (const topic of WEBHOOK_TOPICS) {
    const address =
      topic === 'app/uninstalled'
        ? `${baseUrl}/api/shopify/uninstall`
        : `${baseUrl}/api/webhooks/shopify/${topicToPath(topic)}`;

    const response = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address,
            format: 'json',
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      // 422 often means already registered — treat as success for idempotency
      if (response.status !== 422) {
        log.warn(
          { shop: shopDomain, topic, status: response.status, body },
          'Webhook registration failed',
        );
        continue;
      }
    }

    log.info({ shop: shopDomain, topic, address }, 'Webhook registered');
  }
}
