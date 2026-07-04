'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from '@shopify/polaris';

import {
  ChartContainer,
  IntentChart,
  SplitChart,
  VolumeChart,
} from '@/components/ChartContainer';
import { showToast } from '@/components/Providers';
import { StatCard } from '@/components/StatCard';
import {
  api,
  type ConversationSummary,
  type DashboardMetrics,
  type MerchantProfile,
} from '@/lib/api';
import { formatCurrency, formatDate, formatPercent } from '@/lib/format';

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [greeting, setGreeting] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard, list, profile] = await Promise.all([
        api.getDashboard(),
        api.getConversations('page=1&pageSize=5'),
        api.getMerchant(),
      ]);
      setMetrics(dashboard);
      setConversations(list.items);
      setMerchant(profile);
      setGreeting(
        String(profile.widgetConfig?.greeting ?? 'Hi! How can we help?'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
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
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    return days.map((day) => ({
      day: day.slice(5),
      count: conversations.filter((item) => item.createdAt.startsWith(day))
        .length,
    }));
  }, [conversations, metrics?.series]);

  const intentData = [
    { intent: 'WISMO', count: 12 },
    { intent: 'Pre-sale', count: 9 },
    { intent: 'Returns', count: 6 },
    { intent: 'Technical', count: 4 },
  ];

  const splitData = useMemo(() => {
    const ai = metrics?.metrics.aiResolved ?? 0;
    const human = Math.max(0, (metrics?.metrics.conversations ?? 0) - ai);
    return [
      { name: 'AI', value: ai || 1 },
      { name: 'Human', value: human || 1 },
    ];
  }, [metrics]);

  const pauseAi = async () => {
    if (!merchant) return;
    try {
      const next = !merchant.isActive;
      // Optimistic: only local until settings endpoint supports isActive toggle
      setMerchant({ ...merchant, isActive: next });
      await api.updateSettings({
        widgetConfig: {
          ...merchant.widgetConfig,
          aiPaused: !next,
        },
      });
      showToast(next ? 'AI resumed' : 'AI paused');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', true);
      void load();
    }
  };

  const saveGreeting = async () => {
    if (!merchant) return;
    const previous = merchant;
    setMerchant({
      ...merchant,
      widgetConfig: { ...merchant.widgetConfig, greeting },
    });
    try {
      await api.updateSettings({
        widgetConfig: { ...merchant.widgetConfig, greeting },
      });
      showToast('Greeting updated');
    } catch (err) {
      setMerchant(previous);
      showToast(err instanceof Error ? err.message : 'Update failed', true);
    }
  };

  return (
    <Page
      title="Overview"
      primaryAction={{ content: 'Refresh', onAction: () => void load() }}
    >
      <BlockStack gap="500">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        <div className="nova-grid nova-grid--stats">
          <StatCard
            title="AI resolution rate"
            value={
              loading
                ? '—'
                : formatPercent(metrics?.metrics.aiResolutionRate ?? 0)
            }
            trend="7d"
            tone="success"
          />
          <StatCard
            title="Avg response time"
            value={
              loading
                ? '—'
                : metrics?.metrics.avgResponseMs != null
                  ? `${(metrics.metrics.avgResponseMs / 1000).toFixed(1)}s`
                  : '—'
            }
            subtitle={
              metrics?.metrics.csatScore != null
                ? `CSAT ${metrics.metrics.csatScore.toFixed(1)}`
                : 'AI first response'
            }
            tone="info"
          />
          <StatCard
            title="Active conversations"
            value={String(metrics?.metrics.conversations ?? 0)}
            subtitle={`${metrics?.metrics.escalated ?? 0} escalated`}
          />
          <StatCard
            title="Revenue recovered"
            value={formatCurrency(metrics?.metrics.revenueRecovered)}
            tone="success"
          />
        </div>

        <div className="nova-grid nova-grid--charts">
          <ChartContainer title="Conversation volume (7-day)">
            <VolumeChart data={volumeData} />
          </ChartContainer>
          <ChartContainer title="Top intents">
            <IntentChart data={intentData} />
          </ChartContainer>
          <ChartContainer title="AI vs human">
            <SplitChart data={splitData} />
          </ChartContainer>
        </div>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Quick actions
            </Text>
            <InlineStack gap="300" wrap>
              <Button onClick={() => void pauseAi()}>
                {merchant?.isActive === false ? 'Resume AI' : 'Pause AI'}
              </Button>
              <div style={{ minWidth: 280, flex: 1 }}>
                <TextField
                  label="Widget greeting"
                  labelHidden
                  value={greeting}
                  onChange={setGreeting}
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => void saveGreeting()}>Save</Button>
                  }
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Recent conversations
            </Text>
            {conversations.map((item) => (
              <InlineStack
                key={item.id}
                align="space-between"
                blockAlign="center"
              >
                <BlockStack gap="050">
                  <Text as="span" fontWeight="semibold">
                    {item.customerEmail ?? 'Anonymous'}
                  </Text>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {item.messages?.[0]?.content ?? item.status}
                  </Text>
                </BlockStack>
                <Text as="span" tone="subdued" variant="bodySm">
                  {formatDate(item.createdAt)}
                </Text>
              </InlineStack>
            ))}
            {conversations.length === 0 ? (
              <Text as="p" tone="subdued">
                No conversations yet.
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
