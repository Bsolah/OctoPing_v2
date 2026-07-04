export const MAX_BODY_BYTES = 1_000_000;
export const RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const WEBHOOK_STREAM_KEY = 'shopify:webhooks';

export const HANDLED_WEBHOOK_TOPICS = new Set([
  'orders/create',
  'orders/updated',
  'fulfillments/create',
  'customers/create',
  'app/uninstalled',
]);

export function getApiBackendUrl(): string {
  return (
    process.env.API_BACKEND_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'
  );
}

export function getShopifyAppUrl(): string | undefined {
  return process.env.SHOPIFY_APP_URL?.replace(/\/$/, '');
}

export function getShopifyApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error('SHOPIFY_API_SECRET is required');
  }
  return secret;
}

export function getGatewayApiKey(): string | undefined {
  return process.env.GATEWAY_API_KEY;
}
