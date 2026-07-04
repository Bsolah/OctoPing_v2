import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { trackEvent } from '@/lib/analytics/events';
import { recordAiResolutionUsage } from '@/lib/billing/usage';
import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';

const DIRECT_WINDOW_MS = 60 * 60 * 1000; // 1 hour after conversation ends
const INFLUENCE_WINDOW_MS = 24 * 60 * 60 * 1000; // return-later influence

export type AttributionResult = {
  conversationId: string;
  recoveredCartValue: number;
  savedOrderValue: number;
  upsellValue: number;
  directRevenue: number;
  influenceRevenue: number;
  totalRevenue: number;
  attributions: number;
};

function money(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  return Number(value ?? 0);
}

function productSet(ids: string[]): Set<string> {
  return new Set(ids.filter(Boolean));
}

/**
 * Orders whose line items were fully present in the cart when chat started
 * are excluded unless we can classify them as a recovered cart.
 */
function wasAlreadyInCart(
  orderProductIds: string[],
  cartProductIds: string[],
): boolean {
  if (orderProductIds.length === 0 || cartProductIds.length === 0) {
    return false;
  }
  const cart = productSet(cartProductIds);
  return orderProductIds.every((id) => cart.has(id));
}

function upsellDelta(
  orderTotal: number,
  cartValueAtStart: number | null,
  orderProductIds: string[],
  cartProductIds: string[],
): number {
  const cart = productSet(cartProductIds);
  const newItems = orderProductIds.filter((id) => !cart.has(id));
  if (newItems.length === 0) return 0;
  if (cartValueAtStart != null && orderTotal > cartValueAtStart) {
    return orderTotal - cartValueAtStart;
  }
  // Approximate: pro-rate by share of new SKUs
  const share = newItems.length / Math.max(orderProductIds.length, 1);
  return orderTotal * share;
}

async function hadAbandonedCheckout(
  merchantId: string,
  email: string | null,
  before: Date,
): Promise<boolean> {
  if (!email) return false;
  const event = await prisma.event.findFirst({
    where: {
      merchantId,
      eventType: 'checkout.abandoned',
      createdAt: { lte: before },
      properties: {
        path: ['email'],
        equals: email,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return Boolean(event);
}

async function hadSaveIntent(conversationId: string): Promise<boolean> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      senderType: 'ai',
      OR: [
        { aiIntent: { contains: 'cancel', mode: 'insensitive' } },
        { aiIntent: { contains: 'return', mode: 'insensitive' } },
        { aiIntent: { contains: 'refund', mode: 'insensitive' } },
      ],
    },
    take: 1,
  });
  return messages.length > 0;
}

/**
 * Match a conversation to orders and write revenue attributions.
 * Direct: purchase within 1 hour after conversation ends.
 * Influence: purchase after chat started, outside the direct window, within 24h.
 */
export async function attributeRevenue(
  conversationId: string,
): Promise<AttributionResult> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });

  const endedAt = conversation.endedAt;
  const startedAt = conversation.createdAt;
  const directEnd = endedAt
    ? new Date(endedAt.getTime() + DIRECT_WINDOW_MS)
    : null;
  const influenceEnd = new Date(startedAt.getTime() + INFLUENCE_WINDOW_MS);
  const orderWindowEnd =
    directEnd && directEnd > influenceEnd ? directEnd : influenceEnd;

  const email = conversation.customerEmail;
  if (!email) {
    return emptyResult(conversationId);
  }

  const orders = await prisma.order.findMany({
    where: {
      merchantId: conversation.merchantId,
      customerEmail: { equals: email, mode: 'insensitive' },
      createdAt: {
        gte: startedAt,
        lte: orderWindowEnd,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  let recoveredCartValue = 0;
  let savedOrderValue = 0;
  let upsellValue = 0;
  let directRevenue = 0;
  let influenceRevenue = 0;
  let attributions = 0;

  const abandoned = await hadAbandonedCheckout(
    conversation.merchantId,
    email,
    startedAt,
  );
  const saveIntent = await hadSaveIntent(conversationId);
  const cartIds = conversation.cartProductIds ?? [];
  const cartValue = conversation.cartValueAtStart
    ? money(conversation.cartValueAtStart)
    : null;

  for (const order of orders) {
    const amount = money(order.totalPrice);
    if (amount <= 0) continue;

    const alreadyInCart = wasAlreadyInCart(order.productIds ?? [], cartIds);
    const inDirectWindow = Boolean(
      endedAt &&
      directEnd &&
      order.createdAt >= endedAt &&
      order.createdAt <= directEnd,
    );
    const inInfluenceWindow =
      order.createdAt >= startedAt &&
      order.createdAt <= influenceEnd &&
      !inDirectWindow;

    if (!inDirectWindow && !inInfluenceWindow) {
      continue;
    }

    // Exclude pre-existing cart checkouts unless recovered or saved
    if (alreadyInCart && !abandoned && !saveIntent) {
      continue;
    }

    const attributionType = inDirectWindow ? 'direct' : 'influence';
    const rows: Array<{
      revenueType: string;
      amount: number;
    }> = [];

    if (alreadyInCart && abandoned) {
      rows.push({ revenueType: 'recovered_cart', amount });
      recoveredCartValue += amount;
    } else if (saveIntent && alreadyInCart) {
      rows.push({ revenueType: 'saved_order', amount });
      savedOrderValue += amount;
    } else {
      const upsell = upsellDelta(
        amount,
        cartValue,
        order.productIds ?? [],
        cartIds,
      );
      const base = Math.max(0, amount - upsell);
      if (base > 0) {
        rows.push({ revenueType: 'purchase', amount: base });
      }
      if (upsell > 0) {
        rows.push({ revenueType: 'upsell', amount: upsell });
        upsellValue += upsell;
      }
      if (rows.length === 0) {
        rows.push({ revenueType: 'purchase', amount });
      }
    }

    for (const row of rows) {
      try {
        await prisma.revenueAttribution.upsert({
          where: {
            conversationId_orderId_revenueType: {
              conversationId,
              orderId: order.id,
              revenueType: row.revenueType,
            },
          },
          create: {
            id: randomUUID(),
            merchantId: conversation.merchantId,
            conversationId,
            orderId: order.id,
            shopifyOrderId: order.shopifyOrderId,
            attributionType,
            revenueType: row.revenueType,
            amount: row.amount,
            properties: {
              alreadyInCart,
              abandoned,
              saveIntent,
            },
          },
          update: {
            attributionType,
            amount: row.amount,
            properties: {
              alreadyInCart,
              abandoned,
              saveIntent,
            },
          },
        });
        attributions += 1;
      } catch (error) {
        getLogger().warn(
          { err: error, conversationId, orderId: order.id },
          'Failed to upsert revenue attribution',
        );
      }
    }

    if (attributionType === 'direct') {
      directRevenue += amount;
    } else {
      influenceRevenue += amount;
    }

    if (alreadyInCart && abandoned) {
      trackEvent(conversation.merchantId, 'cart_recovered', {
        conversationId,
        orderId: order.id,
        amount,
      });
    }
  }

  const totalRevenue = directRevenue + influenceRevenue;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      revenueImpact: totalRevenue > 0 ? totalRevenue : null,
    },
  });

  return {
    conversationId,
    recoveredCartValue,
    savedOrderValue,
    upsellValue,
    directRevenue,
    influenceRevenue,
    totalRevenue,
    attributions,
  };
}

function emptyResult(conversationId: string): AttributionResult {
  return {
    conversationId,
    recoveredCartValue: 0,
    savedOrderValue: 0,
    upsellValue: 0,
    directRevenue: 0,
    influenceRevenue: 0,
    totalRevenue: 0,
    attributions: 0,
  };
}

/**
 * Mark conversation ended, optionally as AI-resolved, then attribute revenue.
 */
export async function endConversationAndAttribute(
  conversationId: string,
  options: { aiResolution?: boolean } = {},
): Promise<AttributionResult> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });

  const aiResolution =
    options.aiResolution ??
    (!conversation.escalatedTo &&
      conversation.assignedAgentId == null &&
      conversation.status !== 'escalated');

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      endedAt: conversation.endedAt ?? new Date(),
      status:
        conversation.status === 'escalated' ? conversation.status : 'resolved',
      aiResolution,
    },
  });

  if (aiResolution) {
    await recordAiResolutionUsage(conversationId);
  }

  return attributeRevenue(conversationId);
}

/**
 * Attribute revenue for all conversations that ended on a given UTC day.
 */
export async function attributeRevenueForDay(
  merchantId: string,
  day: Date,
): Promise<number> {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    where: {
      merchantId,
      OR: [
        { endedAt: { gte: start, lt: end } },
        {
          endedAt: null,
          status: { in: ['resolved', 'closed'] },
          updatedAt: { gte: start, lt: end },
        },
      ],
    },
    select: { id: true },
  });

  let count = 0;
  for (const conversation of conversations) {
    const result = await attributeRevenue(conversation.id);
    count += result.attributions;
  }
  return count;
}

/**
 * Roll event + attribution metrics into analytics_daily_summaries for one day.
 */
export async function rollupDailySummary(
  merchantId: string,
  day: Date,
): Promise<void> {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const events = await prisma.event.groupBy({
    by: ['eventType'],
    where: {
      merchantId,
      createdAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  const countOf = (type: string) =>
    events.find((e) => e.eventType === type)?._count._all ?? 0;

  const widgetEvents = await prisma.event.findMany({
    where: {
      merchantId,
      eventType: 'widget_opened',
      createdAt: { gte: start, lt: end },
    },
    select: { properties: true },
  });

  let controlVisitors = 0;
  let treatmentVisitors = 0;
  for (const event of widgetEvents) {
    const props = (event.properties ?? {}) as { controlGroup?: boolean };
    if (props.controlGroup) controlVisitors += 1;
    else treatmentVisitors += 1;
  }

  const orderEvents = await prisma.event.findMany({
    where: {
      merchantId,
      eventType: 'order_placed',
      createdAt: { gte: start, lt: end },
    },
    select: { properties: true },
  });

  let controlConversions = 0;
  let treatmentConversions = 0;
  for (const event of orderEvents) {
    const props = (event.properties ?? {}) as { controlGroup?: boolean };
    if (props.controlGroup) controlConversions += 1;
    else treatmentConversions += 1;
  }

  const attributions = await prisma.revenueAttribution.findMany({
    where: {
      merchantId,
      attributedAt: { gte: start, lt: end },
    },
  });

  let recoveredCartValue = 0;
  let savedOrderValue = 0;
  let upsellValue = 0;
  let directRevenue = 0;
  let influenceRevenue = 0;

  for (const row of attributions) {
    const amount = money(row.amount);
    if (row.revenueType === 'recovered_cart') recoveredCartValue += amount;
    if (row.revenueType === 'saved_order') savedOrderValue += amount;
    if (row.revenueType === 'upsell') upsellValue += amount;
    if (row.attributionType === 'direct') directRevenue += amount;
    if (row.attributionType === 'influence') influenceRevenue += amount;
  }

  const responseEvents = await prisma.event.findMany({
    where: {
      merchantId,
      eventType: 'ai_response',
      createdAt: { gte: start, lt: end },
    },
    select: { properties: true },
  });
  const responseMs = responseEvents
    .map((e) => Number((e.properties as { responseMs?: number })?.responseMs))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgResponseMs =
    responseMs.length > 0
      ? responseMs.reduce((a, b) => a + b, 0) / responseMs.length
      : null;

  const feedback = await prisma.event.findMany({
    where: {
      merchantId,
      eventType: 'ai.feedback',
      createdAt: { gte: start, lt: end },
    },
    select: { properties: true },
  });
  const ratings = feedback
    .map((e) => {
      const rating = (e.properties as { rating?: string | number })?.rating;
      if (rating === 'up') return 5;
      if (rating === 'down') return 1;
      return typeof rating === 'number' ? rating : null;
    })
    .filter((n): n is number => n != null);
  const csatScore =
    ratings.length > 0
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : null;

  const conversationsStarted = countOf('conversation_started');
  const aiResolutions = countOf('ai_resolution');
  const resolutionRate =
    conversationsStarted > 0 ? aiResolutions / conversationsStarted : null;

  await prisma.analyticsDailySummary.upsert({
    where: {
      merchantId_date: {
        merchantId,
        date: start,
      },
    },
    create: {
      id: randomUUID(),
      merchantId,
      date: start,
      conversationsStarted,
      aiResponses: countOf('ai_response'),
      humanEscalations: countOf('human_escalation'),
      aiResolutions,
      cartRecovered: countOf('cart_recovered'),
      ordersPlaced: countOf('order_placed'),
      widgetOpened: countOf('widget_opened'),
      proactiveTriggered: countOf('proactive_triggered'),
      recoveredCartValue,
      savedOrderValue,
      upsellValue,
      directRevenue,
      influenceRevenue,
      controlVisitors,
      treatmentVisitors,
      controlConversions,
      treatmentConversions,
      avgResponseMs,
      csatScore,
      resolutionRate,
    },
    update: {
      conversationsStarted,
      aiResponses: countOf('ai_response'),
      humanEscalations: countOf('human_escalation'),
      aiResolutions,
      cartRecovered: countOf('cart_recovered'),
      ordersPlaced: countOf('order_placed'),
      widgetOpened: countOf('widget_opened'),
      proactiveTriggered: countOf('proactive_triggered'),
      recoveredCartValue,
      savedOrderValue,
      upsellValue,
      directRevenue,
      influenceRevenue,
      controlVisitors,
      treatmentVisitors,
      controlConversions,
      treatmentConversions,
      avgResponseMs,
      csatScore,
      resolutionRate,
    },
  });
}
