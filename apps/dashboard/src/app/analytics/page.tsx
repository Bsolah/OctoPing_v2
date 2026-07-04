'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Card,
  InlineStack,
  Page,
  Text,
} from '@shopify/polaris';

import {
  ChartContainer,
  IntentChart,
  VolumeChart,
} from '@/components/ChartContainer';
import { StatCard } from '@/components/StatCard';
import {
  api,
  type ConversationSummary,
  type DashboardMetrics,
  type RevenueResponse,
} from '@/lib/api';
import { formatCurrency, formatPercent } from '@/lib/format';

function formatMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dashboard, revenueData, list] = await Promise.all([
        api.getDashboard(),
        api.getRevenue(),
        api.getAnalyticsConversations(),
      ]);
      setMetrics(dashboard);
      setRevenue(revenueData);
      setConversations(
        list.items.map((item) => ({
          id: item.id,
          status: item.status,
          channel: item.channel,
          customerEmail: item.customerEmail,
          createdAt: item.createdAt,
          revenueImpact: item.revenueImpact,
          aiResolution: item.aiResolution,
          messages: item.messages,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const volumeData = useMemo(() => {
    if (metrics?.series?.length) {
      return metrics.series.map((row) => ({
        day: row.day.slice(5),
        count: row.conversations,
      }));
    }
    const map = new Map<string, number>();
    for (const item of conversations) {
      const day = item.createdAt.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day: day.slice(5), count }));
  }, [conversations, metrics?.series]);

  const revenueSeries = useMemo(() => {
    if (!metrics?.series?.length) return [];
    return metrics.series.map((row) => ({
      intent: row.day.slice(5),
      count: Math.round(row.revenue),
    }));
  }, [metrics?.series]);

  const intentBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of conversations as Array<
      ConversationSummary & { intents?: string[] }
    >) {
      const intents =
        (item as ConversationSummary & { intents?: string[] }).intents ?? [];
      if (intents.length === 0) {
        map.set('unknown', (map.get('unknown') ?? 0) + 1);
        continue;
      }
      for (const intent of intents) {
        map.set(intent, (map.get(intent) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([intent, count]) => ({ intent, count }));
  }, [conversations]);

  const exportCsv = () => {
    const rows = [
      [
        'id',
        'status',
        'channel',
        'customerEmail',
        'createdAt',
        'revenueImpact',
        'aiResolution',
      ],
      ...conversations.map((item) => [
        item.id,
        item.status,
        item.channel,
        item.customerEmail ?? '',
        item.createdAt,
        String(item.revenueImpact ?? ''),
        String(item.aiResolution ?? ''),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nova-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const m = metrics?.metrics;

  return (
    <Page
      title="Analytics"
      subtitle={
        metrics?.cached
          ? 'Cached report (historical period)'
          : 'Live metrics for the current period'
      }
      primaryAction={{ content: 'Export CSV', onAction: exportCsv }}
      secondaryActions={[{ content: 'Refresh', onAction: () => void load() }]}
    >
      <BlockStack gap="500">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        <div className="nova-grid nova-grid--stats">
          <StatCard
            title="AI resolution rate"
            value={formatPercent(m?.aiResolutionRate ?? 0)}
          />
          <StatCard
            title="Avg response time"
            value={formatMs(m?.avgResponseMs)}
          />
          <StatCard
            title="CSAT"
            value={m?.csatScore != null ? m.csatScore.toFixed(1) : '—'}
          />
          <StatCard
            title="Attributed revenue"
            value={formatCurrency(
              m?.revenueRecovered ?? revenue?.totalRevenueAttributed,
            )}
          />
        </div>

        <div className="nova-grid nova-grid--stats">
          <StatCard
            title="Recovered carts"
            value={formatCurrency(
              m?.recoveredCartValue ?? revenue?.recoveredCartValue,
            )}
          />
          <StatCard
            title="Saved orders"
            value={formatCurrency(
              m?.savedOrderValue ?? revenue?.savedOrderValue,
            )}
          />
          <StatCard
            title="Upsell value"
            value={formatCurrency(m?.upsellValue ?? revenue?.upsellValue)}
          />
          <StatCard
            title="ROI"
            value={revenue?.roi != null ? `${revenue.roi.toFixed(1)}x` : '—'}
          />
        </div>

        <div className="nova-grid nova-grid--charts">
          <ChartContainer title="Conversation volume">
            <VolumeChart data={volumeData} />
          </ChartContainer>
          <ChartContainer title="Daily attributed revenue">
            <IntentChart
              data={
                revenueSeries.length
                  ? revenueSeries
                  : [{ intent: '—', count: 0 }]
              }
            />
          </ChartContainer>
        </div>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Control group lift
            </Text>
            <Text as="p" tone="subdued">
              10% of visitors are held out from the widget to measure
              incremental conversion.
            </Text>
            <InlineStack align="space-between">
              <Text as="span">Treatment conversion</Text>
              <Text as="span">
                {m?.treatmentConversionRate != null
                  ? formatPercent(m.treatmentConversionRate)
                  : '—'}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span">Control conversion</Text>
              <Text as="span">
                {m?.controlConversionRate != null
                  ? formatPercent(m.controlConversionRate)
                  : '—'}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span">Lift</Text>
              <Text as="span">
                {m?.conversionLift != null
                  ? formatPercent(m.conversionLift)
                  : '—'}
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Top intents
            </Text>
            {intentBreakdown.length === 0 ? (
              <Text as="p" tone="subdued">
                Intent data appears as conversations are handled.
              </Text>
            ) : (
              intentBreakdown.map((row) => (
                <InlineStack key={row.intent} align="space-between">
                  <Text as="span">{row.intent}</Text>
                  <Text as="span" tone="subdued">
                    {row.count} conversations
                  </Text>
                </InlineStack>
              ))
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Revenue attribution
              </Text>
              <Text as="span" tone="subdued">
                Direct {formatCurrency(revenue?.directRevenue)} · Influence{' '}
                {formatCurrency(revenue?.influenceRevenue)}
              </Text>
            </InlineStack>
            {(revenue?.items ?? []).slice(0, 12).map((item) => (
              <InlineStack key={item.id} align="space-between">
                <BlockStack gap="100">
                  <Text as="span">
                    {item.customerEmail ?? item.conversationId ?? item.id}
                  </Text>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {item.attributionType ?? 'direct'} ·{' '}
                    {item.revenueType ?? 'purchase'}
                  </Text>
                </BlockStack>
                <Text as="span">
                  {formatCurrency(item.amount ?? item.revenueImpact)}
                </Text>
              </InlineStack>
            ))}
            {(revenue?.items.length ?? 0) === 0 ? (
              <Text as="p" tone="subdued">
                No attributed revenue in this period. Attribution runs within 1
                hour after a conversation ends.
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
