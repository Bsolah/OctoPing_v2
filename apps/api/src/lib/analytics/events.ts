import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';

export const ANALYTICS_EVENT_TYPES = [
  'conversation_started',
  'ai_response',
  'human_escalation',
  'ai_resolution',
  'cart_recovered',
  'order_placed',
  'widget_opened',
  'proactive_triggered',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export type AnalyticsEventProperties = Record<string, unknown> & {
  conversationId?: string;
  visitorId?: string;
  controlGroup?: boolean;
  responseMs?: number;
  amount?: number;
  orderId?: string;
  rating?: 'up' | 'down' | number;
};

type BufferedEvent = {
  id: string;
  merchantId: string;
  eventType: AnalyticsEventType;
  conversationId: string | null;
  properties: AnalyticsEventProperties;
  createdAt: Date;
};

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 1_000;

const buffer: BufferedEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

function clickhouseUrl(): string | null {
  const url = process.env.CLICKHOUSE_URL?.trim();
  return url || null;
}

/**
 * Deterministic 10% control group assignment for visitors.
 * Control visitors do not see the widget; used for conversion lift.
 */
export function isControlGroupVisitor(visitorId: string): boolean {
  let hash = 0;
  for (let i = 0; i < visitorId.length; i += 1) {
    hash = (hash * 31 + visitorId.charCodeAt(i)) >>> 0;
  }
  return hash % 10 === 0;
}

/**
 * Fire-and-forget analytics event. Batched to PostgreSQL (and ClickHouse when configured).
 */
export function trackEvent(
  merchantId: string,
  eventType: AnalyticsEventType,
  properties: AnalyticsEventProperties = {},
): void {
  const conversationId =
    typeof properties.conversationId === 'string'
      ? properties.conversationId
      : null;

  buffer.push({
    id: randomUUID(),
    merchantId,
    eventType,
    conversationId,
    properties,
    createdAt: new Date(),
  });

  if (buffer.length >= BATCH_SIZE) {
    void flushEvents();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushEvents();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }
}

export async function flushEvents(): Promise<number> {
  if (flushing || buffer.length === 0) {
    return 0;
  }

  flushing = true;
  const batch = buffer.splice(0, buffer.length);

  try {
    await prisma.event.createMany({
      data: batch.map((event) => ({
        id: event.id,
        merchantId: event.merchantId,
        eventType: event.eventType,
        conversationId: event.conversationId,
        properties: event.properties as Prisma.InputJsonValue,
        createdAt: event.createdAt,
      })),
    });

    await insertClickHouseEvents(batch);
    return batch.length;
  } catch (error) {
    // Re-queue failed batch so we do not drop analytics silently
    buffer.unshift(...batch);
    getLogger().error(
      { err: error, count: batch.length },
      'Analytics flush failed',
    );
    return 0;
  } finally {
    flushing = false;
  }
}

async function insertClickHouseEvents(batch: BufferedEvent[]): Promise<void> {
  const url = clickhouseUrl();
  if (!url || batch.length === 0) return;

  const rows = batch
    .map((event) =>
      JSON.stringify({
        id: event.id,
        merchant_id: event.merchantId,
        event_type: event.eventType,
        conversation_id: event.conversationId,
        properties: JSON.stringify(event.properties),
        created_at: event.createdAt
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ''),
      }),
    )
    .join('\n');

  try {
    const response = await fetch(
      `${url.replace(/\/$/, '')}/?query=${encodeURIComponent('INSERT INTO nova_events FORMAT JSONEachRow')}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.CLICKHOUSE_USER
            ? {
                'X-ClickHouse-User': process.env.CLICKHOUSE_USER,
                'X-ClickHouse-Key': process.env.CLICKHOUSE_PASSWORD ?? '',
              }
            : {}),
        },
        body: rows,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      getLogger().warn(
        { status: response.status, text },
        'ClickHouse insert failed; events remain in PostgreSQL',
      );
    }
  } catch (error) {
    getLogger().warn(
      { err: error },
      'ClickHouse unavailable; using PostgreSQL only',
    );
  }
}

/** Force flush on shutdown. */
export async function shutdownAnalytics(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushEvents();
}
