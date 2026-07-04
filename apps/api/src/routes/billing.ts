import type { FastifyPluginAsync } from 'fastify';

import { z } from 'zod';

import { getPlan, listPlans, type PlanId } from '@/lib/billing/plans';
import {
  cancelSubscription,
  createSubscription,
  listInvoices,
  verifySubscription,
} from '@/lib/billing/shopify-billing';
import {
  checkUsageLimit,
  getUsageHistory,
  periodKey,
} from '@/lib/billing/usage';
import { resolveMerchant } from '@/lib/merchant-context';
import { prisma } from '@/lib/prisma';
import { parseBody, parseQuery } from '@/lib/validate';

const UpgradeSchema = z.object({
  plan: z.enum(['free', 'growth', 'scale', 'enterprise']),
});

const UsageQuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/billing/plans', async () => {
    return { plans: listPlans() };
  });

  app.get('/api/v1/billing/plan', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const subscription = await verifySubscription(merchant.id);
    const refreshed = await prisma.merchant.findUniqueOrThrow({
      where: { id: merchant.id },
    });
    const plan = getPlan(refreshed.planTier);
    const usage = await checkUsageLimit(refreshed.id);

    return {
      plan,
      planTier: refreshed.planTier,
      subscription: {
        id: subscription.id ?? refreshed.subscriptionId,
        status: subscription.status ?? refreshed.subscriptionStatus,
        trialEndsAt: refreshed.trialEndsAt,
        currentPeriodStart: refreshed.currentPeriodStart,
        currentPeriodEnd: refreshed.currentPeriodEnd,
        cancelledAt: refreshed.cancelledAt,
        gracePeriodEndsAt: refreshed.gracePeriodEndsAt,
        test: subscription.test,
      },
      usage,
      plans: listPlans(),
    };
  });

  app.post('/api/v1/billing/upgrade', async (request, reply) => {
    const body = parseBody(UpgradeSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    if (body.plan === 'enterprise') {
      return reply.status(400).send({
        error: {
          message: 'Contact sales for Enterprise pricing',
          statusCode: 400,
        },
      });
    }

    if (
      body.plan === merchant.planTier &&
      merchant.subscriptionStatus === 'active'
    ) {
      return {
        ok: true,
        planTier: merchant.planTier,
        confirmationUrl: null,
        message: 'Already on this plan',
      };
    }

    try {
      const result = await createSubscription(merchant.id, body.plan as PlanId);

      if (body.plan === 'free') {
        return {
          ok: true,
          planTier: 'free',
          confirmationUrl: null,
          message: 'Downgraded to Free',
        };
      }

      return {
        ok: true,
        planTier: merchant.planTier,
        confirmationUrl: result.confirmationUrl,
        subscriptionId: result.subscriptionId,
        message: result.confirmationUrl
          ? 'Approve the charge in Shopify to complete your plan change (prorated)'
          : 'Plan updated',
      };
    } catch (error) {
      return reply.status(400).send({
        error: {
          message: error instanceof Error ? error.message : 'Upgrade failed',
          statusCode: 400,
        },
      });
    }
  });

  app.get('/api/v1/billing/usage', async (request, reply) => {
    const query = parseQuery(UsageQuerySchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const period = query.period ?? periodKey();
    const [usage, history] = await Promise.all([
      checkUsageLimit(merchant.id),
      getUsageHistory(merchant.id, period),
    ]);

    return {
      usage,
      history,
      period,
    };
  });

  app.post('/api/v1/billing/cancel', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const updated = await cancelSubscription(merchant.id);
    const usage = await checkUsageLimit(updated.id);

    return {
      ok: true,
      planTier: updated.planTier,
      subscriptionStatus: updated.subscriptionStatus,
      cancelledAt: updated.cancelledAt,
      usage,
    };
  });

  app.get('/api/v1/billing/invoices', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const invoices = await listInvoices(merchant.id);
    return { items: invoices };
  });
};

export default billingRoutes;
