import cron from 'node-cron';

import {
  attributeRevenueForDay,
  rollupDailySummary,
} from '@/lib/analytics/attribution';
import { flushEvents } from '@/lib/analytics/events';
import {
  defaultPeriod,
  getConversationReport,
  getDashboardMetrics,
  getRevenueReport,
} from '@/lib/analytics/reports';
import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { set } from '@/lib/redis';

let task: cron.ScheduledTask | null = null;

function previousUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
}

/**
 * Roll up events, attribute prior-day revenue, and warm Redis report caches.
 */
export async function runAnalyticsDailyJob(day = previousUtcDay()): Promise<{
  merchants: number;
  attributions: number;
}> {
  const log = getLogger();
  await flushEvents();

  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  let attributions = 0;

  for (const merchant of merchants) {
    try {
      attributions += await attributeRevenueForDay(merchant.id, day);
      await rollupDailySummary(merchant.id, day);

      const period = {
        from: day,
        to: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1),
      };

      const [dashboard, revenue, conversations] = await Promise.all([
        getDashboardMetrics(merchant.id, period),
        getRevenueReport(merchant.id, period),
        getConversationReport(merchant.id, period),
      ]);

      // Warm longer-lived cache keys for the closed day
      const dayKey = day.toISOString().slice(0, 10);
      await Promise.all([
        set(
          `analytics:daily:${merchant.id}:${dayKey}:dashboard`,
          dashboard,
          86_400,
        ),
        set(
          `analytics:daily:${merchant.id}:${dayKey}:revenue`,
          revenue,
          86_400,
        ),
        set(
          `analytics:daily:${merchant.id}:${dayKey}:conversations`,
          conversations,
          86_400,
        ),
      ]);

      // Also refresh trailing 7/30 day caches (excluding live today bias via closed end)
      const trailing7 = defaultPeriod(7);
      trailing7.to = new Date(
        Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate(),
          23,
          59,
          59,
        ),
      );
      await getDashboardMetrics(merchant.id, trailing7);
      await getRevenueReport(merchant.id, trailing7);
    } catch (error) {
      log.error(
        { err: error, merchantId: merchant.id, day },
        'Analytics daily rollup failed for merchant',
      );
    }
  }

  log.info(
    { merchants: merchants.length, attributions, day: day.toISOString() },
    'Analytics daily job completed',
  );

  return { merchants: merchants.length, attributions };
}

/**
 * Schedule daily rollup at 00:15 UTC.
 */
export function startAnalyticsDailyJob(): void {
  if (task) return;

  task = cron.schedule(
    '15 0 * * *',
    () => {
      void runAnalyticsDailyJob().catch((error) => {
        getLogger().error({ err: error }, 'Analytics daily job crashed');
      });
    },
    { timezone: 'UTC' },
  );

  getLogger().info('Analytics daily job scheduled (00:15 UTC)');
}

export function stopAnalyticsDailyJob(): void {
  task?.stop();
  task = null;
}
