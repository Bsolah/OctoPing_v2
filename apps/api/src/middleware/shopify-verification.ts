import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { getLogger } from '@/lib/observability';
import { getShopifyApiSecret } from '@/lib/shopify/config';
import { validateWebhookHMAC } from '@/lib/security';

declare module 'fastify' {
  interface FastifyRequest {
    shopifyWebhook?: {
      topic: string;
      shopDomain: string;
      webhookId: string;
      rawBody: string;
    };
  }
}

/**
 * Verifies Shopify webhook HMAC using the raw request body.
 * Requires `addContentTypeParser` for application/json to preserve raw body.
 */
export function verifyShopifyWebhookRequest(request: FastifyRequest): boolean {
  const hmac = request.headers['x-shopify-hmac-sha256'];
  const signature = Array.isArray(hmac) ? hmac[0] : hmac;
  const rawBody =
    (request as FastifyRequest & { rawBody?: string }).rawBody ??
    (typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body ?? {}));

  const valid = validateWebhookHMAC(
    rawBody,
    signature ?? '',
    getShopifyApiSecret(),
  );

  getLogger().info(
    {
      topic: request.headers['x-shopify-topic'],
      shopDomain: request.headers['x-shopify-shop-domain'],
      webhookId: request.headers['x-shopify-webhook-id'],
      hasSignature: Boolean(signature),
      valid,
    },
    'Shopify webhook HMAC verification',
  );

  return valid;
}

const shopifyVerificationPlugin: FastifyPluginAsync = async (app) => {
  // Preserve raw body for HMAC verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      (request as FastifyRequest & { rawBody?: string }).rawBody = raw;
      try {
        const json = raw.length > 0 ? JSON.parse(raw) : {};
        done(null, json);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
};

export default fp(shopifyVerificationPlugin, {
  name: 'shopify-verification',
});
