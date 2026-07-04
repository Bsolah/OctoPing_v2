import { get, set } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const MS_DAY = 24 * 60 * 60 * 1000;

export type Period = { from: Date; to: Date };

export type DashboardMetricsReport = {
  period: { from: string; to: string };
  cached: boolean;
  metrics: {
    conversations: number;
    resolved: number;
    escalated: number;
    aiResolved: number;
    aiResolutionRate: number;
    avgResponseMs: number | null;
    csatScore: number | null;
    revenueRecovered: number;
    recoveredCartValue: number;
    savedOrderValue: number;
    upsellValue: number;
    controlConversionRate: number | null;
    treatmentConversionRate: number | null;
    conversionLift: number | null;
  };
  series: Array<{ day: string; conversations: number; revenue: number }>;
};

export type RevenueReport = {
  period: { from: string; to: string };
  cached: boolean;
  totalRevenueAttributed: number;
  directRevenue: number;
  influenceRevenue: number;
  recoveredCartValue: number;
  savedOrderValue: number;
  upsellValue: number;
  roi: number | null;
  items: Array<{
    id: string;
    conversationId: string;
    customerEmail: string | null;
    attributionType: string;
    revenueType: string;
    amount: number;
    attributedAt: string;
    aiResolution: boolean;
    status: string;
    createdAt: string;
  }>;
};

export type ConversationReport = {
  period: { from: string; to: string };
  cached: boolean;
  items: Array<{
    id: string;
    status: string;
    channel: string;
    customerEmail: string | null;
    aiResolution: boolean;
    revenueImpact: number | null;
    priority: number;
    createdAt: string;
    endedAt: string | null;
    messages: Array<{ content: string; createdAt: string }>;
    intents: string[];
    avgConfidence: number | null;
  }>;
};

function periodIncludesToday(to: Date): boolean {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  return to.getTime() >= todayStart.getTime();
}

function cacheKey(
  kind: string,
  merchantId: string,
  from: Date,
  to: Date,
  extra = '',
): string {
  return `analytics:${kind}:${merchantId}:${from.toISOString()}:${to.toISOString()}${extra}`;
}

function money(value: unknown): number {
  return Number(value ?? 0);
}

function rate(numer: number, denom: number): number | null {
  if (denom <= 0) return null;
  return numer / denom;
}

/**
 * Dashboard metrics: resolution rate, response time, CSAT, revenue, control lift.
 * Historical periods are cached for 1 hour; ranges including today are live.
 */
export async function getDashboardMetrics(
  merchantId: string,
  period: Period,
): Promise<DashboardMetricsReport> {
  const key = cacheKey('dashboard', merchantId, period.from, period.to);
  const live = periodIncludesToday(period.to);

  if (!live) {
    const cached = await get<DashboardMetricsReport>(key);
    if (cached) return { ...cached, cached: true };
  }

  const where = {
    merchantId,
    createdAt: { gte: period.from, lte: period.to },
  };

  const [
    total,
    resolved,
    escalated,
    aiResolved,
    attributions,
    summaries,
    conversations,
  ] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.count({ where: { ...where, status: 'resolved' } }),
    prisma.conversation.count({ where: { ...where, status: 'escalated' } }),
    prisma.conversation.count({ where: { ...where, aiResolution: true } }),
    prisma.revenueAttribution.findMany({
      where: {
        merchantId,
        attributedAt: { gte: period.from, lte: period.to },
      },
    }),
    prisma.analyticsDailySummary.findMany({
      where: {
        merchantId,
        date: { gte: period.from, lte: period.to },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.conversation.findMany({
      where,
      select: {
        createdAt: true,
        revenueImpact: true,
      },
    }),
  ]);

  let recoveredCartValue = 0;
  let savedOrderValue = 0;
  let upsellValue = 0;
  let revenueRecovered = 0;

  for (const row of attributions) {
    const amount = money(row.amount);
    revenueRecovered += amount;
    if (row.revenueType === 'recovered_cart') recoveredCartValue += amount;
    if (row.revenueType === 'saved_order') savedOrderValue += amount;
    if (row.revenueType === 'upsell') upsellValue += amount;
  }

  // Prefer rollups for response/CSAT/control when available
  let avgResponseMs: number | null = null;
  let csatScore: number | null = null;
  let controlVisitors = 0;
  let treatmentVisitors = 0;
  let controlConversions = 0;
  let treatmentConversions = 0;

  if (summaries.length > 0) {
    const responseSamples = summaries
      .map((s) => s.avgResponseMs)
      .filter((n): n is number => n != null);
    avgResponseMs =
      responseSamples.length > 0
        ? responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length
        : null;

    const csatSamples = summaries
      .map((s) => s.csatScore)
      .filter((n): n is number => n != null);
    csatScore =
      csatSamples.length > 0
        ? csatSamples.reduce((a, b) => a + b, 0) / csatSamples.length
        : null;

    for (const summary of summaries) {
      controlVisitors += summary.controlVisitors;
      treatmentVisitors += summary.treatmentVisitors;
      controlConversions += summary.controlConversions;
      treatmentConversions += summary.treatmentConversions;
      if (revenueRecovered === 0) {
        recoveredCartValue += money(summary.recoveredCartValue);
        savedOrderValue += money(summary.savedOrderValue);
        upsellValue += money(summary.upsellValue);
        revenueRecovered +=
          money(summary.directRevenue) + money(summary.influenceRevenue);
      }
    }
  }

  const controlConversionRate = rate(controlConversions, controlVisitors);
  const treatmentConversionRate = rate(treatmentConversions, treatmentVisitors);
  const conversionLift =
    controlConversionRate != null &&
    treatmentConversionRate != null &&
    controlConversionRate > 0
      ? (treatmentConversionRate - controlConversionRate) /
        controlConversionRate
      : controlConversionRate != null && treatmentConversionRate != null
        ? treatmentConversionRate - controlConversionRate
        : null;

  const dayMap = new Map<string, { conversations: number; revenue: number }>();
  for (const conversation of conversations) {
    const day = conversation.createdAt.toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { conversations: 0, revenue: 0 };
    entry.conversations += 1;
    entry.revenue += money(conversation.revenueImpact);
    dayMap.set(day, entry);
  }

  const report: DashboardMetricsReport = {
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    cached: false,
    metrics: {
      conversations: total,
      resolved,
      escalated,
      aiResolved,
      aiResolutionRate: total > 0 ? aiResolved / total : 0,
      avgResponseMs,
      csatScore,
      revenueRecovered,
      recoveredCartValue,
      savedOrderValue,
      upsellValue,
      controlConversionRate,
      treatmentConversionRate,
      conversionLift,
    },
    series: [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, values]) => ({ day, ...values })),
  };

  if (!live) {
    await set(key, report, CACHE_TTL_SECONDS);
  } else {
    // Cache today's snapshot briefly for burst protection
    await set(key, report, 60);
  }

  return report;
}

/**
 * Revenue attribution report with ROI (attributed revenue / estimated support cost proxy).
 */
export async function getRevenueReport(
  merchantId: string,
  period: Period,
): Promise<RevenueReport> {
  const key = cacheKey('revenue', merchantId, period.from, period.to);
  const live = periodIncludesToday(period.to);

  if (!live) {
    const cached = await get<RevenueReport>(key);
    if (cached) return { ...cached, cached: true };
  }

  const attributions = await prisma.revenueAttribution.findMany({
    where: {
      merchantId,
      attributedAt: { gte: period.from, lte: period.to },
    },
    include: {
      conversation: {
        select: {
          customerEmail: true,
          aiResolution: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { attributedAt: 'desc' },
    take: 200,
  });

  let directRevenue = 0;
  let influenceRevenue = 0;
  let recoveredCartValue = 0;
  let savedOrderValue = 0;
  let upsellValue = 0;

  const items = attributions.map((row) => {
    const amount = money(row.amount);
    if (row.attributionType === 'direct') directRevenue += amount;
    if (row.attributionType === 'influence') influenceRevenue += amount;
    if (row.revenueType === 'recovered_cart') recoveredCartValue += amount;
    if (row.revenueType === 'saved_order') savedOrderValue += amount;
    if (row.revenueType === 'upsell') upsellValue += amount;

    return {
      id: row.id,
      conversationId: row.conversationId,
      customerEmail: row.conversation.customerEmail,
      attributionType: row.attributionType,
      revenueType: row.revenueType,
      amount,
      attributedAt: row.attributedAt.toISOString(),
      aiResolution: row.conversation.aiResolution,
      status: row.conversation.status,
      createdAt: row.conversation.createdAt.toISOString(),
    };
  });

  const totalRevenueAttributed = directRevenue + influenceRevenue;
  // ROI proxy: attributed revenue vs $0.15 per AI conversation in period
  const conversations = await prisma.conversation.count({
    where: {
      merchantId,
      createdAt: { gte: period.from, lte: period.to },
    },
  });
  const estimatedCost = Math.max(conversations * 0.15, 0.01);
  const roi = totalRevenueAttributed / estimatedCost;

  const report: RevenueReport = {
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    cached: false,
    totalRevenueAttributed,
    directRevenue,
    influenceRevenue,
    recoveredCartValue,
    savedOrderValue,
    upsellValue,
    roi,
    items,
  };

  await set(key, report, live ? 60 : CACHE_TTL_SECONDS);
  return report;
}

/**
 * Detailed conversation log for analytics export / drill-down.
 */
export async function getConversationReport(
  merchantId: string,
  period: Period,
  filters: { status?: string } = {},
): Promise<ConversationReport> {
  const key = cacheKey(
    'conversations',
    merchantId,
    period.from,
    period.to,
    filters.status ? `:${filters.status}` : '',
  );
  const live = periodIncludesToday(period.to);

  if (!live) {
    const cached = await get<ConversationReport>(key);
    if (cached) return { ...cached, cached: true };
  }

  const items = await prisma.conversation.findMany({
    where: {
      merchantId,
      createdAt: { gte: period.from, lte: period.to },
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });

  const aiMessages = await prisma.message.findMany({
    where: {
      conversationId: { in: items.map((i) => i.id) },
      senderType: 'ai',
    },
    select: {
      conversationId: true,
      aiIntent: true,
      aiConfidence: true,
    },
  });

  const byConversation = new Map<
    string,
    { intents: string[]; confidences: number[] }
  >();
  for (const message of aiMessages) {
    const entry = byConversation.get(message.conversationId) ?? {
      intents: [],
      confidences: [],
    };
    if (message.aiIntent) entry.intents.push(message.aiIntent);
    if (message.aiConfidence != null)
      entry.confidences.push(message.aiConfidence);
    byConversation.set(message.conversationId, entry);
  }

  const report: ConversationReport = {
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    cached: false,
    items: items.map((item) => {
      const stats = byConversation.get(item.id);
      const confidences = stats?.confidences ?? [];
      return {
        id: item.id,
        status: item.status,
        channel: item.channel,
        customerEmail: item.customerEmail,
        aiResolution: item.aiResolution,
        revenueImpact:
          item.revenueImpact != null ? money(item.revenueImpact) : null,
        priority: item.priority,
        createdAt: item.createdAt.toISOString(),
        endedAt: item.endedAt?.toISOString() ?? null,
        messages: item.messages.map((m) => ({
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
        intents: [...new Set(stats?.intents ?? [])],
        avgConfidence:
          confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : null,
      };
    }),
  };

  await set(key, report, live ? 60 : CACHE_TTL_SECONDS);
  return report;
}

export function defaultPeriod(days: number): Period {
  const to = new Date();
  const from = new Date(Date.now() - days * MS_DAY);
  return { from, to };
}
