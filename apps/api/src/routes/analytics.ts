import type { FastifyPluginAsync } from 'fastify';

import { AnalyticsQuerySchema } from '@nova/shared';
import { z } from 'zod';

import { isControlGroupVisitor, trackEvent } from '@/lib/analytics/events';
import { planAllowsFeature } from '@/lib/billing/plans';

import {
  defaultPeriod,
  getConversationReport,
  getDashboardMetrics,
  getRevenueReport,
} from '@/lib/analytics/reports';
import { resolveMerchant } from '@/lib/merchant-context';
import { parseBody, parseQuery } from '@/lib/validate';

const TrackEventSchema = z.object({
  eventType: z.enum([
    'conversation_started',
    'ai_response',
    'human_escalation',
    'ai_resolution',
    'cart_recovered',
    'order_placed',
    'widget_opened',
    'proactive_triggered',
  ]),
  conversationId: z.string().uuid().optional(),
  visitorId: z.string().min(1).max(200).optional(),
  properties: z.record(z.unknown()).optional(),
});

function periodFromQuery(query: { from?: string; to?: string }): {
  from: Date;
  to: Date;
} {
  if (query.from || query.to) {
    return {
      from: query.from
        ? new Date(query.from)
        : new Date(Date.now() - 7 * 86_400_000),
      to: query.to ? new Date(query.to) : new Date(),
    };
  }
  return defaultPeriod(7);
}

const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/analytics/dashboard', async (request, reply) => {
    const query = parseQuery(AnalyticsQuerySchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    return getDashboardMetrics(merchant.id, periodFromQuery(query));
  });

  app.get('/api/v1/analytics/conversations', async (request, reply) => {
    const query = parseQuery(AnalyticsQuerySchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    return getConversationReport(merchant.id, periodFromQuery(query), {
      status: query.status,
    });
  });

  app.get('/api/v1/analytics/revenue', async (request, reply) => {
    const query = parseQuery(AnalyticsQuerySchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const period =
      query.from || query.to ? periodFromQuery(query) : defaultPeriod(30);

    return getRevenueReport(merchant.id, period);
  });

  /**
   * Widget / client event intake (widget_opened, proactive_triggered, etc.).
   * Assigns control group for visitor-scoped opens.
   */
  app.post('/api/v1/analytics/events', async (request, reply) => {
    const body = parseBody(TrackEventSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const visitorId = body.visitorId;
    const controlGroup =
      visitorId != null ? isControlGroupVisitor(visitorId) : false;

    // Control visitors should not open the widget UI; still record the assignment
    if (
      body.eventType === 'widget_opened' &&
      controlGroup &&
      request.auth.type === 'widget'
    ) {
      trackEvent(merchant.id, 'widget_opened', {
        ...body.properties,
        visitorId,
        controlGroup: true,
        conversationId: body.conversationId,
      });
      return {
        ok: true,
        controlGroup: true,
        showWidget: false,
      };
    }

    if (
      body.eventType === 'proactive_triggered' &&
      !planAllowsFeature(merchant.planTier, 'proactiveTriggers')
    ) {
      return reply.status(403).send({
        error: {
          message: 'Proactive triggers require Growth or higher',
          statusCode: 403,
        },
      });
    }

    trackEvent(merchant.id, body.eventType, {
      ...body.properties,
      visitorId,
      controlGroup,
      conversationId: body.conversationId,
    });

    return {
      ok: true,
      controlGroup,
      showWidget: !controlGroup,
    };
  });
};

export default analyticsRoutes;
