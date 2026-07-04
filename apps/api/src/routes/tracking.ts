import type { FastifyPluginAsync } from 'fastify';

import { Prisma } from '@prisma/client';

import {
  detectCarrier,
  listCarriers,
  trackShipment,
} from '@/lib/carriers/registry';
import type { TrackingResponse } from '@/lib/carriers/types';
import { resolveMerchant } from '@/lib/merchant-context';
import { prisma } from '@/lib/prisma';

function toVisualTimeline(tracking: TrackingResponse) {
  return tracking.events.map((event, index) => ({
    step: index + 1,
    status: event.status,
    location: event.location ?? null,
    timestamp: event.timestamp,
    description: event.description,
  }));
}

const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/tracking/carriers', async () => ({
    carriers: listCarriers(),
  }));

  app.get<{
    Params: { orderId: string };
    Querystring: { trackingNumber?: string };
  }>('/api/v1/tracking/:orderId', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const order = await prisma.order.findFirst({
      where: { id: request.params.orderId, merchantId: merchant.id },
    });

    if (!order) {
      return reply.status(404).send({
        error: { message: 'Order not found', statusCode: 404 },
      });
    }

    const trackingNumber =
      request.query.trackingNumber ?? order.trackingNumbers[0];

    if (!trackingNumber) {
      return reply.status(400).send({
        error: {
          message: 'No tracking number on order',
          statusCode: 400,
        },
      });
    }

    const carrierHint = order.carrier ?? detectCarrier(trackingNumber);

    try {
      const tracking = await trackShipment(trackingNumber, carrierHint);

      await prisma.order.update({
        where: { id: order.id },
        data: {
          carrier: tracking.carrier,
          trackingStatus: tracking.status,
          fulfillmentStatus: tracking.status,
          estimatedDelivery: tracking.estimatedDelivery
            ? new Date(tracking.estimatedDelivery)
            : undefined,
          trackingHistory: tracking as unknown as Prisma.InputJsonValue,
          lastTrackedAt: new Date(),
          trackingNumbers: order.trackingNumbers.includes(trackingNumber)
            ? order.trackingNumbers
            : [...order.trackingNumbers, trackingNumber],
        },
      });

      return {
        orderId: order.id,
        tracking,
        timeline: toVisualTimeline(tracking),
      };
    } catch (error) {
      // Return last known history if live lookup fails
      if (order.trackingHistory) {
        const cached = order.trackingHistory as unknown as TrackingResponse;
        return {
          orderId: order.id,
          tracking: { ...cached, source: 'cache' as const },
          timeline: toVisualTimeline(cached),
          stale: true,
          error: error instanceof Error ? error.message : 'Tracking failed',
        };
      }

      return reply.status(502).send({
        error: {
          message:
            error instanceof Error ? error.message : 'Tracking lookup failed',
          statusCode: 502,
        },
      });
    }
  });
};

export default trackingRoutes;
