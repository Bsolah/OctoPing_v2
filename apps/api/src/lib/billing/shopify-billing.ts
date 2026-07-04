import type { Merchant } from '@prisma/client';

import { getPlan, type PlanId } from '@/lib/billing/plans';
import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { getAppUrl } from '@/lib/shopify/config';
import { shopifyFetch } from '@/lib/shopify/graphql';

export type SubscriptionInfo = {
  id: string | null;
  status: string | null;
  name: string | null;
  planId: PlanId;
  trialDays: number | null;
  currentPeriodEnd: string | null;
  test: boolean;
  lineItems: Array<{
    id: string;
    price: number | null;
    currencyCode: string | null;
    interval: string | null;
  }>;
};

export type InvoiceRecord = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  currentPeriodEnd: string | null;
  price: number | null;
  currencyCode: string | null;
};

function isTestBilling(): boolean {
  return (
    process.env.SHOPIFY_BILLING_TEST === 'true' ||
    process.env.NODE_ENV !== 'production'
  );
}

function planFromSubscriptionName(name: string | null | undefined): PlanId {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('scale')) return 'scale';
  if (lower.includes('growth')) return 'growth';
  return 'free';
}

/**
 * Create a Shopify app subscription for a paid plan.
 * Returns a confirmation URL the merchant must approve (proration via APPLY_IMMEDIATELY).
 */
export async function createSubscription(
  merchantId: string,
  planId: PlanId,
): Promise<{ confirmationUrl: string | null; subscriptionId: string | null }> {
  const plan = getPlan(planId);
  if (plan.id === 'free') {
    await cancelSubscription(merchantId);
    return { confirmationUrl: null, subscriptionId: null };
  }

  if (plan.id === 'enterprise' || plan.priceMonthlyUsd == null) {
    const error = new Error(
      'Enterprise plans require sales contact — no self-serve checkout',
    );
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const returnUrl = `${getAppUrl()}/billing?shop=${encodeURIComponent(merchant.shopDomain)}&billing=1`;

  const mutation = `
    mutation CreateSubscription(
      $name: String!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
      $lineItems: [AppSubscriptionLineItemInput!]!
      $replacementBehavior: AppSubscriptionReplacementBehavior
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
        lineItems: $lineItems
        replacementBehavior: $replacementBehavior
      ) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }
  `;

  const trialDays =
    plan.trialDays > 0 && !merchant.trialEndsAt ? plan.trialDays : 0;

  const { data } = await shopifyFetch<{
    appSubscriptionCreate: {
      appSubscription?: { id: string; status: string } | null;
      confirmationUrl?: string | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(merchant.shopDomain, mutation, {
    name: plan.shopifyPlanName,
    returnUrl,
    trialDays: trialDays || null,
    test: isTestBilling(),
    // Prorate immediately when changing plans
    replacementBehavior: 'APPLY_IMMEDIATELY',
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: plan.priceMonthlyUsd, currencyCode: 'USD' },
            interval: 'EVERY_30_DAYS',
          },
        },
      },
    ],
  });

  const payload = data.appSubscriptionCreate;
  if (payload.userErrors.length > 0) {
    throw new Error(payload.userErrors.map((e) => e.message).join('; '));
  }

  const subscriptionId = payload.appSubscription?.id ?? null;

  await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      subscriptionId,
      subscriptionStatus:
        payload.appSubscription?.status?.toLowerCase() ?? 'pending',
      // Plan applies after merchant confirms; keep current until verify
    },
  });

  return {
    confirmationUrl: payload.confirmationUrl ?? null,
    subscriptionId,
  };
}

/**
 * Verify active subscription with Shopify and sync merchant plan fields.
 */
export async function verifySubscription(
  merchantId: string,
): Promise<SubscriptionInfo> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const query = `
    query ActiveSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          createdAt
          currentPeriodEnd
          trialDays
          test
          lineItems {
            id
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price { amount currencyCode }
                  interval
                }
                ... on AppUsagePricing {
                  cappedAmount { amount currencyCode }
                  terms
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const { data } = await shopifyFetch<{
      currentAppInstallation: {
        activeSubscriptions: Array<{
          id: string;
          name: string;
          status: string;
          createdAt: string;
          currentPeriodEnd?: string | null;
          trialDays?: number | null;
          test: boolean;
          lineItems: Array<{
            id: string;
            plan: {
              pricingDetails?: {
                price?: { amount: string; currencyCode: string };
                interval?: string;
                cappedAmount?: { amount: string; currencyCode: string };
                terms?: string;
              } | null;
            };
          }>;
        }>;
      };
    }>(merchant.shopDomain, query);

    const active = data.currentAppInstallation.activeSubscriptions[0] ?? null;

    if (!active || active.status !== 'ACTIVE') {
      // No active paid sub — fall back to free unless enterprise override
      if (merchant.planTier !== 'enterprise') {
        await prisma.merchant.update({
          where: { id: merchantId },
          data: {
            planTier: 'free',
            subscriptionStatus: active?.status?.toLowerCase() ?? 'cancelled',
            subscriptionId: active?.id ?? merchant.subscriptionId,
          },
        });
      }

      return {
        id: active?.id ?? null,
        status: active?.status?.toLowerCase() ?? null,
        name: active?.name ?? null,
        planId: merchant.planTier === 'enterprise' ? 'enterprise' : 'free',
        trialDays: active?.trialDays ?? null,
        currentPeriodEnd: active?.currentPeriodEnd ?? null,
        test: active?.test ?? false,
        lineItems: [],
      };
    }

    const planId = planFromSubscriptionName(active.name);
    const trialEndsAt =
      active.trialDays && active.trialDays > 0
        ? new Date(
            new Date(active.createdAt).getTime() +
              active.trialDays * 86_400_000,
          )
        : null;

    const usageLineItemId =
      active.lineItems.find((item) =>
        Boolean(item.plan.pricingDetails?.cappedAmount),
      )?.id ?? null;

    await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        planTier: planId,
        subscriptionId: active.id,
        subscriptionStatus: 'active',
        trialEndsAt,
        currentPeriodStart: new Date(active.createdAt),
        currentPeriodEnd: active.currentPeriodEnd
          ? new Date(active.currentPeriodEnd)
          : null,
        cancelledAt: null,
        gracePeriodEndsAt: null,
        usageLineItemId,
      },
    });

    return {
      id: active.id,
      status: 'active',
      name: active.name,
      planId,
      trialDays: active.trialDays ?? null,
      currentPeriodEnd: active.currentPeriodEnd ?? null,
      test: active.test,
      lineItems: active.lineItems.map((item) => ({
        id: item.id,
        price: item.plan.pricingDetails?.price
          ? Number(item.plan.pricingDetails.price.amount)
          : null,
        currencyCode:
          item.plan.pricingDetails?.price?.currencyCode ??
          item.plan.pricingDetails?.cappedAmount?.currencyCode ??
          null,
        interval: item.plan.pricingDetails?.interval ?? null,
      })),
    };
  } catch (error) {
    getLogger().warn(
      { err: error, merchantId },
      'Failed to verify Shopify subscription; using local plan',
    );
    return {
      id: merchant.subscriptionId,
      status: merchant.subscriptionStatus,
      name: getPlan(merchant.planTier).shopifyPlanName,
      planId: getPlan(merchant.planTier).id,
      trialDays: null,
      currentPeriodEnd: merchant.currentPeriodEnd?.toISOString() ?? null,
      test: isTestBilling(),
      lineItems: [],
    };
  }
}

/**
 * Create an app usage charge for overage (requires usage pricing line item).
 */
export async function handleUsageCharge(
  merchantId: string,
  amount: number,
  description = 'AI resolution overage',
): Promise<{ id: string | null; created: boolean }> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  if (!merchant.subscriptionId || !merchant.usageLineItemId) {
    return { id: null, created: false };
  }

  if (amount <= 0) {
    return { id: null, created: false };
  }

  const mutation = `
    mutation UsageCharge($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId
        price: $price
        description: $description
      ) {
        appUsageRecord { id }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyFetch<{
    appUsageRecordCreate: {
      appUsageRecord?: { id: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(merchant.shopDomain, mutation, {
    subscriptionLineItemId: merchant.usageLineItemId,
    price: { amount, currencyCode: 'USD' },
    description,
  });

  if (data.appUsageRecordCreate.userErrors.length > 0) {
    throw new Error(
      data.appUsageRecordCreate.userErrors.map((e) => e.message).join('; '),
    );
  }

  return {
    id: data.appUsageRecordCreate.appUsageRecord?.id ?? null,
    created: true,
  };
}

/**
 * Cancel the active Shopify subscription and revert to free.
 */
export async function cancelSubscription(
  merchantId: string,
): Promise<Merchant> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  if (merchant.subscriptionId) {
    const mutation = `
      mutation CancelSubscription($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription { id status }
          userErrors { field message }
        }
      }
    `;

    try {
      const { data } = await shopifyFetch<{
        appSubscriptionCancel: {
          appSubscription?: { id: string; status: string } | null;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(merchant.shopDomain, mutation, { id: merchant.subscriptionId });

      if (data.appSubscriptionCancel.userErrors.length > 0) {
        getLogger().warn(
          { errors: data.appSubscriptionCancel.userErrors, merchantId },
          'Subscription cancel userErrors',
        );
      }
    } catch (error) {
      getLogger().warn(
        { err: error, merchantId },
        'Subscription cancel failed',
      );
    }
  }

  return prisma.merchant.update({
    where: { id: merchantId },
    data: {
      planTier: 'free',
      subscriptionStatus: 'cancelled',
      cancelledAt: new Date(),
      trialEndsAt: null,
      usageLineItemId: null,
    },
  });
}

/**
 * Invoice / charge history from Shopify app subscriptions.
 */
export async function listInvoices(
  merchantId: string,
): Promise<InvoiceRecord[]> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const query = `
    query SubscriptionHistory {
      currentAppInstallation {
        allSubscriptions(first: 25, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              status
              createdAt
              currentPeriodEnd
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const { data } = await shopifyFetch<{
      currentAppInstallation: {
        allSubscriptions: {
          edges: Array<{
            node: {
              id: string;
              name: string;
              status: string;
              createdAt: string;
              currentPeriodEnd?: string | null;
              lineItems: Array<{
                plan: {
                  pricingDetails?: {
                    price?: { amount: string; currencyCode: string };
                  } | null;
                };
              }>;
            };
          }>;
        };
      };
    }>(merchant.shopDomain, query);

    return data.currentAppInstallation.allSubscriptions.edges.map(
      ({ node }) => {
        const priceDetails = node.lineItems[0]?.plan.pricingDetails?.price;
        return {
          id: node.id,
          name: node.name,
          status: node.status,
          createdAt: node.createdAt,
          currentPeriodEnd: node.currentPeriodEnd ?? null,
          price: priceDetails ? Number(priceDetails.amount) : null,
          currencyCode: priceDetails?.currencyCode ?? null,
        };
      },
    );
  } catch (error) {
    getLogger().warn({ err: error, merchantId }, 'Failed to list invoices');
    if (!merchant.subscriptionId) return [];
    return [
      {
        id: merchant.subscriptionId,
        name: getPlan(merchant.planTier).shopifyPlanName,
        status: merchant.subscriptionStatus ?? 'UNKNOWN',
        createdAt:
          merchant.currentPeriodStart?.toISOString() ??
          merchant.createdAt.toISOString(),
        currentPeriodEnd: merchant.currentPeriodEnd?.toISOString() ?? null,
        price: getPlan(merchant.planTier).priceMonthlyUsd,
        currencyCode: 'USD',
      },
    ];
  }
}
