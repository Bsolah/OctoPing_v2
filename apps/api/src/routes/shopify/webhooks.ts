import type { FastifyPluginAsync } from 'fastify';

import { attributeRevenue } from '@/lib/analytics/attribution';
import { isControlGroupVisitor, trackEvent } from '@/lib/analytics/events';
import { verifySubscription } from '@/lib/billing/shopify-billing';
import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { pathToTopic } from '@/lib/shopify/config';
import { handleAppUninstalled } from '@/lib/shopify/lifecycle';
import { upsertOrderFromWebhook } from '@/lib/shopify/sync';
import { verifyShopifyWebhookRequest } from '@/middleware/shopify-verification';

const shopifyWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { topic: string };
    Body: Record<string, unknown>;
  }>('/api/webhooks/shopify/:topic', async (request, reply) => {
    if (!verifyShopifyWebhookRequest(request)) {
      return reply.status(401).send({
        error: { message: 'Invalid webhook signature', statusCode: 401 },
      });
    }

    const topic = pathToTopic(request.params.topic);
    const shopHeader = request.headers['x-shopify-shop-domain'];
    const shopDomain = (Array.isArray(shopHeader) ? shopHeader[0] : shopHeader)
      ?.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

    const webhookIdHeader = request.headers['x-shopify-webhook-id'];
    const webhookId = Array.isArray(webhookIdHeader)
      ? webhookIdHeader[0]
      : webhookIdHeader;

    if (!shopDomain) {
      return reply.status(400).send({
        error: { message: 'Missing shop domain', statusCode: 400 },
      });
    }

    // Idempotency: skip already-processed webhook deliveries
    if (webhookId) {
      const existing = await prisma.webhookDelivery.findUnique({
        where: { id: webhookId },
      });
      if (existing) {
        return reply.status(200).send({ ok: true, duplicate: true });
      }
    }

    const merchant = await prisma.merchant.findUnique({
      where: { shopDomain },
    });

    if (!merchant && topic !== 'app/uninstalled') {
      getLogger().warn({ shopDomain, topic }, 'Webhook for unknown merchant');
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const payload = request.body ?? {};

    try {
      switch (topic) {
        case 'orders/create':
        case 'orders/updated':
          if (merchant) {
            const order = await upsertOrderFromWebhook(merchant.id, payload);
            if (topic === 'orders/create' && order.created) {
              const visitorId =
                typeof payload.checkout_token === 'string'
                  ? payload.checkout_token
                  : typeof payload.cart_token === 'string'
                    ? payload.cart_token
                    : undefined;
              const controlGroup = visitorId
                ? isControlGroupVisitor(visitorId)
                : false;

              trackEvent(merchant.id, 'order_placed', {
                orderId: order.id,
                amount:
                  payload.total_price != null
                    ? Number(payload.total_price)
                    : undefined,
                visitorId,
                controlGroup,
                email: order.customerEmail,
              });

              if (order.customerEmail) {
                const recent = await prisma.conversation.findMany({
                  where: {
                    merchantId: merchant.id,
                    customerEmail: {
                      equals: order.customerEmail,
                      mode: 'insensitive',
                    },
                    createdAt: {
                      gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    },
                  },
                  select: { id: true },
                  take: 5,
                  orderBy: { createdAt: 'desc' },
                });
                for (const conversation of recent) {
                  void attributeRevenue(conversation.id).catch(() => undefined);
                }
              }
            }
          }
          break;

        case 'fulfillments/create':
          if (merchant) {
            const orderId = payload.order_id;
            if (orderId != null) {
              const trackingNumbers = Array.isArray(payload.tracking_numbers)
                ? payload.tracking_numbers.filter(
                    (n): n is string => typeof n === 'string',
                  )
                : [];
              const carrier =
                typeof payload.tracking_company === 'string'
                  ? payload.tracking_company
                  : null;

              await prisma.order.updateMany({
                where: {
                  merchantId: merchant.id,
                  shopifyOrderId: BigInt(String(orderId)),
                },
                data: {
                  fulfillmentStatus: 'fulfilled',
                  trackingNumbers,
                  carrier,
                },
              });
            }
          }
          break;

        case 'customers/create':
          if (merchant) {
            await prisma.event.create({
              data: {
                merchantId: merchant.id,
                eventType: 'customer.created',
                properties: {
                  shopifyCustomerId:
                    payload.id != null ? String(payload.id) : null,
                  email:
                    typeof payload.email === 'string' ? payload.email : null,
                  firstName:
                    typeof payload.first_name === 'string'
                      ? payload.first_name
                      : null,
                  lastName:
                    typeof payload.last_name === 'string'
                      ? payload.last_name
                      : null,
                },
              },
            });
          }
          break;

        case 'checkouts/update':
          if (merchant) {
            const abandoned =
              payload.abandoned_checkout_url != null ||
              payload.completed_at == null;

            await prisma.event.create({
              data: {
                merchantId: merchant.id,
                eventType: abandoned
                  ? 'checkout.abandoned'
                  : 'checkout.updated',
                properties: {
                  checkoutId: payload.id != null ? String(payload.id) : null,
                  email:
                    typeof payload.email === 'string' ? payload.email : null,
                  abandonedCheckoutUrl:
                    typeof payload.abandoned_checkout_url === 'string'
                      ? payload.abandoned_checkout_url
                      : null,
                  totalPrice:
                    payload.total_price != null
                      ? String(payload.total_price)
                      : null,
                },
              },
            });
          }
          break;

        case 'app_subscriptions/update':
          if (merchant) {
            await verifySubscription(merchant.id);
          }
          break;

        case 'app/uninstalled':
          await handleAppUninstalled(shopDomain);
          break;

        default:
          getLogger().info({ topic }, 'Unhandled Shopify webhook topic');
      }

      if (webhookId) {
        await prisma.webhookDelivery.create({
          data: {
            id: webhookId,
            topic,
            shopDomain,
          },
        });
      }

      return reply.status(200).send({ ok: true });
    } catch (error) {
      getLogger().error(
        { err: error, topic, shopDomain },
        'Webhook handler failed',
      );
      // Return 200 for idempotent client retries only when we recorded delivery.
      // On processing failure, return 500 so Shopify retries.
      return reply.status(500).send({
        error: { message: 'Webhook processing failed', statusCode: 500 },
      });
    }
  });
};

export default shopifyWebhookRoutes;
