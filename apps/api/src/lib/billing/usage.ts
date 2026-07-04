import type { Merchant } from '@prisma/client';

import { trackEvent } from '@/lib/analytics/events';
import { getPlan, type PlanId } from '@/lib/billing/plans';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';

const SOFT_LIMIT_RATIO = 0.8;
const FREE_GRACE_DAYS = 3;
const HUMAN_ONLY_MESSAGE =
  'We have reached our AI support limit for this billing period. A human agent will assist you shortly.';

export type UsageSnapshot = {
  merchantId: string;
  planId: PlanId;
  periodKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  softWarning: boolean;
  hardLimited: boolean;
  inGracePeriod: boolean;
  gracePeriodEndsAt: string | null;
  allowed: boolean;
  humanOnlyMessage: string | null;
};

export type DailyUsage = {
  day: string;
  count: number;
};

function periodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function usageKey(merchantId: string, period = periodKey()): string {
  return `billing:usage:${merchantId}:${period}`;
}

function dailyKey(merchantId: string, day: string): string {
  return `billing:usage:daily:${merchantId}:${day}`;
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function periodBounds(period = periodKey()): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 1));
  return { start, end };
}

/**
 * Atomic monthly usage increment (AI resolutions only).
 */
export async function incrementUsage(merchantId: string): Promise<number> {
  const redis = getRedis();
  const period = periodKey();
  const key = usageKey(merchantId, period);
  const day = dayKey();

  const used = await redis.incr(key);
  if (used === 1) {
    // Expire a bit after month end
    const { end } = periodBounds(period);
    const ttlSeconds = Math.max(
      60,
      Math.ceil((end.getTime() + 7 * 86_400_000 - Date.now()) / 1000),
    );
    await redis.expire(key, ttlSeconds);
  }

  const daily = dailyKey(merchantId, day);
  const dailyCount = await redis.incr(daily);
  if (dailyCount === 1) {
    await redis.expire(daily, 40 * 86_400);
  }

  return used;
}

export async function getUsageCount(
  merchantId: string,
  period = periodKey(),
): Promise<number> {
  const raw = await getRedis().get(usageKey(merchantId, period));
  if (raw != null) return Number(raw) || 0;

  // Fallback to DB for cold Redis
  const { start, end } = periodBounds(period);
  const counted = await prisma.conversation.count({
    where: {
      merchantId,
      usageCounted: true,
      aiResolution: true,
      updatedAt: { gte: start, lt: end },
    },
  });

  if (counted > 0) {
    await getRedis().set(
      usageKey(merchantId, period),
      String(counted),
      'EX',
      40 * 86_400,
    );
  }

  return counted;
}

async function ensureGracePeriod(merchant: Merchant): Promise<Merchant> {
  if (merchant.planTier !== 'free') {
    return merchant;
  }
  if (merchant.gracePeriodEndsAt) {
    return merchant;
  }

  const ends = new Date(Date.now() + FREE_GRACE_DAYS * 86_400_000);
  return prisma.merchant.update({
    where: { id: merchant.id },
    data: { gracePeriodEndsAt: ends },
  });
}

/**
 * Check remaining quota. Soft warn at 80%, hard stop at 100%
 * (free tier gets a 3-day grace period before hard limiting).
 */
export async function checkUsageLimit(
  merchantId: string,
): Promise<UsageSnapshot> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });
  const plan = getPlan(merchant.planTier);
  const period = periodKey();
  const used = await getUsageCount(merchantId, period);
  const limit = plan.aiResolutionsPerMonth;

  if (limit == null) {
    return {
      merchantId,
      planId: plan.id,
      periodKey: period,
      used,
      limit: null,
      remaining: null,
      percentUsed: null,
      softWarning: false,
      hardLimited: false,
      inGracePeriod: false,
      gracePeriodEndsAt: null,
      allowed: true,
      humanOnlyMessage: null,
    };
  }

  const percentUsed = used / limit;
  const remaining = Math.max(0, limit - used);
  const softWarning = percentUsed >= SOFT_LIMIT_RATIO && percentUsed < 1;
  const atOrOverLimit = used >= limit;

  let inGracePeriod = false;
  let gracePeriodEndsAt: string | null = null;
  let hardLimited = false;
  let workingMerchant = merchant;

  if (atOrOverLimit && plan.id === 'free') {
    workingMerchant = await ensureGracePeriod(merchant);
    gracePeriodEndsAt =
      workingMerchant.gracePeriodEndsAt?.toISOString() ?? null;
    inGracePeriod = Boolean(
      workingMerchant.gracePeriodEndsAt &&
      workingMerchant.gracePeriodEndsAt.getTime() > Date.now(),
    );
    hardLimited = !inGracePeriod;
  } else if (atOrOverLimit) {
    hardLimited = true;
  }

  return {
    merchantId,
    planId: plan.id,
    periodKey: period,
    used,
    limit,
    remaining,
    percentUsed,
    softWarning: softWarning || (atOrOverLimit && inGracePeriod),
    hardLimited,
    inGracePeriod,
    gracePeriodEndsAt,
    allowed: !hardLimited,
    humanOnlyMessage: hardLimited ? HUMAN_ONLY_MESSAGE : null,
  };
}

export async function getUsageHistory(
  merchantId: string,
  period = periodKey(),
): Promise<DailyUsage[]> {
  const { start, end } = periodBounds(period);
  const days: DailyUsage[] = [];
  const redis = getRedis();

  for (
    let cursor = new Date(start);
    cursor < end && cursor <= new Date();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    const raw = await redis.get(dailyKey(merchantId, day));
    let count = Number(raw) || 0;

    if (!raw) {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      count = await prisma.conversation.count({
        where: {
          merchantId,
          usageCounted: true,
          aiResolution: true,
          updatedAt: { gte: dayStart, lt: dayEnd },
        },
      });
    }

    days.push({ day, count });
  }

  return days;
}

/**
 * Mark a conversation as AI-resolved and count it against monthly quota once.
 * Human-handled conversations (assigned agent / escalated) are excluded.
 */
export async function recordAiResolutionUsage(
  conversationId: string,
): Promise<{ counted: boolean; used?: number }> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation || conversation.usageCounted) {
    return { counted: false };
  }

  // Human-handled conversations do not count toward AI quota
  if (conversation.assignedAgentId || conversation.status === 'escalated') {
    return { counted: false };
  }

  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      usageCounted: false,
      assignedAgentId: null,
      status: { not: 'escalated' },
    },
    data: {
      aiResolution: true,
      usageCounted: true,
      endedAt: conversation.endedAt ?? new Date(),
    },
  });

  if (updated.count === 0) {
    return { counted: false };
  }

  const used = await incrementUsage(conversation.merchantId);
  trackEvent(conversation.merchantId, 'ai_resolution', {
    conversationId,
    used,
  });

  return { counted: true, used };
}

/**
 * Gate AI replies. Returns a human-only fallback message when hard-limited.
 */
export async function enforceAiUsage(merchantId: string): Promise<{
  allowed: boolean;
  softWarning: boolean;
  usage: UsageSnapshot;
  message: string | null;
}> {
  const usage = await checkUsageLimit(merchantId);
  return {
    allowed: usage.allowed,
    softWarning: usage.softWarning,
    usage,
    message: usage.humanOnlyMessage,
  };
}

export { HUMAN_ONLY_MESSAGE, periodKey };
