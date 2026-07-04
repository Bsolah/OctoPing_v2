import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import {
  captureException,
  createRequestLogger,
  getLogger,
} from '@/lib/observability';
import rateLimitPlugin from '@/middleware/rateLimit';
import securityPlugin, { MAX_BODY_BYTES } from '@/middleware/security';
import shopifyVerificationPlugin from '@/middleware/shopify-verification';
import authPlugin from '@/plugins/auth';
import agentsRoutes from '@/routes/agents';
import aiRoutes from '@/routes/ai';
import analyticsRoutes from '@/routes/analytics';
import billingRoutes from '@/routes/billing';
import conversationsRoutes from '@/routes/conversations';

import { healthRoutes } from '@/routes/health';
import merchantsRoutes from '@/routes/merchants';
import shopifyAuthRoutes from '@/routes/shopify/auth';
import shopifyWebhookRoutes from '@/routes/shopify/webhooks';
import trackingRoutes from '@/routes/tracking';
import websocketRoutes from '@/websocket/handler';
import { bootstrapCarriers } from '@/lib/carriers/registry';

export type BuildAppOptions = {
  logger?: boolean;
};

/**
 * Fastify application factory — registers plugins and route modules.
 */
export async function buildApp(options: BuildAppOptions = {}) {
  bootstrapCarriers();

  const app = Fastify({
    logger: options.logger === false ? false : getLogger(),
    disableRequestLogging: false,
    bodyLimit: MAX_BODY_BYTES,
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      if (typeof header === 'string' && header.length > 0) {
        return header;
      }
      return crypto.randomUUID();
    },
  });

  // Raw body for Shopify webhook HMAC
  await app.register(shopifyVerificationPlugin);

  // Security headers + strict CORS (Shopify domains)
  await app.register(securityPlugin);

  // JWT / session / API key auth
  await app.register(authPlugin);

  // IP (100/min) + merchant (1000/min) rate limits
  await app.register(rateLimitPlugin);

  // WebSockets
  await app.register(websocket);

  app.addHook('onRequest', async (request) => {
    const merchantId = request.auth?.merchantId ?? request.session?.merchantId;
    request.log = createRequestLogger({
      requestId: request.id,
      method: request.method,
      url: request.url,
      ...(merchantId ? { merchantId } : {}),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const safeMessage =
      error.statusCode && error.statusCode < 500
        ? error.message
        : 'Internal Server Error';

    captureException(error, {
      url: request.url,
      merchantId: request.auth?.merchantId ?? request.session?.merchantId,
      userId: request.auth?.userId ?? request.session?.userId,
    });

    request.log.error(
      {
        err: {
          message: error.message,
          stack: error.stack,
          statusCode: error.statusCode,
        },
        url: request.url,
        method: request.method,
      },
      'Request failed',
    );

    if (!reply.sent) {
      reply.status(error.statusCode ?? 500).send({
        error: {
          message: safeMessage,
          statusCode: error.statusCode ?? 500,
        },
      });
    }
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(shopifyAuthRoutes);
  await app.register(shopifyWebhookRoutes);
  await app.register(conversationsRoutes);
  await app.register(agentsRoutes);
  await app.register(aiRoutes);
  await app.register(merchantsRoutes);
  await app.register(analyticsRoutes);
  await app.register(billingRoutes);
  await app.register(trackingRoutes);
  await app.register(websocketRoutes);

  return app;
}
