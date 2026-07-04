export const SHOPIFY_API_VERSION = '2024-10';

export const DEFAULT_SCOPES = [
  'read_products',
  'read_orders',
  'write_orders',
  'read_customers',
  'read_content',
  'read_shipping',
  'read_checkouts',
  'read_fulfillments',
].join(',');

export const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'fulfillments/create',
  'customers/create',
  'checkouts/update',
  'app_subscriptions/update',
  'app/uninstalled',
] as const;

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

/** URL-safe topic segment ↔ Shopify topic */
export function topicToPath(topic: string): string {
  return topic.replace(/\//g, '_');
}

export function pathToTopic(pathTopic: string): string {
  // Topics that already contain underscores (e.g. app_subscriptions/update)
  if (pathTopic === 'app_subscriptions_update') {
    return 'app_subscriptions/update';
  }
  return pathTopic.replace(/_/g, '/');
}

export function getShopifyApiKey(): string {
  const key = process.env.SHOPIFY_API_KEY;
  if (!key) {
    throw new Error('SHOPIFY_API_KEY is required');
  }
  return key;
}

export function getShopifyApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error('SHOPIFY_API_SECRET is required');
  }
  return secret;
}

export function getShopifyScopes(): string {
  return process.env.SHOPIFY_SCOPES ?? DEFAULT_SCOPES;
}

export function getAppUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.SHOPIFY_APP_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function getApiPublicUrl(): string {
  return (
    process.env.API_PUBLIC_URL ??
    process.env.API_BACKEND_URL ??
    `http://localhost:${process.env.PORT ?? 3001}`
  ).replace(/\/$/, '');
}

export function normalizeShopDomain(shop: string): string {
  const cleaned = shop
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  if (!cleaned.includes('.')) {
    return `${cleaned}.myshopify.com`;
  }

  return cleaned;
}
