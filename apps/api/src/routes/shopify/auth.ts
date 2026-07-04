import type { FastifyPluginAsync } from 'fastify';

import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { encryptPII } from '@/lib/security';
import {
  exchangeCodeForToken,
  generateAuthUrl,
  registerWebhooks,
  validateHmac,
} from '@/lib/shopify/auth';
import {
  getApiPublicUrl,
  getAppUrl,
  normalizeShopDomain,
  SHOPIFY_API_VERSION,
} from '@/lib/shopify/config';
import { enqueueShopifyJob } from '@/lib/shopify/jobs';
import { handleAppUninstalled } from '@/lib/shopify/lifecycle';
import { verifyShopifyWebhookRequest } from '@/middleware/shopify-verification';

const shopifyAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { shop?: string } }>(
    '/api/shopify/auth',
    async (request, reply) => {
      const shop = request.query.shop;
      if (!shop) {
        return reply.status(400).send({
          error: { message: 'Missing shop parameter', statusCode: 400 },
        });
      }

      const redirectUri = `${getApiPublicUrl()}/api/shopify/callback`;
      const authUrl = await generateAuthUrl(shop, redirectUri);
      return reply.redirect(authUrl);
    },
  );

  app.get<{
    Querystring: Record<string, string | string[] | undefined>;
  }>('/api/shopify/callback', async (request, reply) => {
    const validation = await validateHmac(request.query);
    if (!validation.valid || !validation.shop) {
      getLogger().warn(
        { reason: validation.reason },
        'Shopify OAuth callback rejected',
      );
      return reply.status(401).send({
        error: { message: 'Invalid OAuth callback', statusCode: 401 },
      });
    }

    const code = String(request.query.code ?? '');
    if (!code) {
      return reply.status(400).send({
        error: { message: 'Missing authorization code', statusCode: 400 },
      });
    }

    const shopDomain = validation.shop;
    const { accessToken } = await exchangeCodeForToken(shopDomain, code);
    const shopDetails = await getShopDetailsWithToken(shopDomain, accessToken);
    const shopifyShopId = BigInt(
      shopDetails.id.split('/').pop() ?? Date.now().toString(),
    );

    const merchant = await prisma.merchant.upsert({
      where: { shopDomain },
      create: {
        shopDomain,
        shopifyShopId,
        accessToken: encryptPII(accessToken),
        isActive: true,
      },
      update: {
        shopifyShopId,
        accessToken: encryptPII(accessToken),
        isActive: true,
      },
    });

    await registerWebhooks(shopDomain, accessToken);

    // Kick off initial data sync in the background
    await enqueueShopifyJob('sync_products', merchant.id);
    await enqueueShopifyJob('sync_policies', merchant.id);
    await enqueueShopifyJob('sync_orders', merchant.id);

    const appUrl = `${getAppUrl()}?shop=${encodeURIComponent(shopDomain)}`;
    return reply.redirect(appUrl);
  });

  // Shopify sends POST for app/uninstalled; GET kept for route discoverability.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/shopify/uninstall',
    handler: async (request, reply) => {
      if (request.method === 'GET') {
        return reply.status(200).send({
          ok: true,
          message: 'Use POST with Shopify webhook HMAC for uninstall events',
        });
      }

      if (!verifyShopifyWebhookRequest(request)) {
        return reply.status(401).send({
          error: { message: 'Invalid webhook signature', statusCode: 401 },
        });
      }

      const shopHeader = request.headers['x-shopify-shop-domain'];
      const shopDomain = normalizeShopDomain(
        Array.isArray(shopHeader) ? (shopHeader[0] ?? '') : (shopHeader ?? ''),
      );

      const webhookIdHeader = request.headers['x-shopify-webhook-id'];
      const webhookId = Array.isArray(webhookIdHeader)
        ? webhookIdHeader[0]
        : webhookIdHeader;

      if (webhookId) {
        const existing = await prisma.webhookDelivery.findUnique({
          where: { id: webhookId },
        });
        if (existing) {
          return reply.status(200).send({ ok: true, duplicate: true });
        }
      }

      await handleAppUninstalled(shopDomain);

      if (webhookId) {
        await prisma.webhookDelivery.create({
          data: {
            id: webhookId,
            topic: 'app/uninstalled',
            shopDomain,
          },
        });
      }

      return reply.status(200).send({ ok: true });
    },
  });
};

/**
 * Shop details using a fresh token (before merchant row exists).
 */
async function getShopDetailsWithToken(shop: string, accessToken: string) {
  const response = await fetch(
    `https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `query { shop { id name myshopifyDomain } }`,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load shop details: ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: { shop: { id: string; name: string; myshopifyDomain: string } };
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length || !payload.data?.shop) {
    throw new Error('Shop details query failed');
  }

  return payload.data.shop;
}

export default shopifyAuthRoutes;
