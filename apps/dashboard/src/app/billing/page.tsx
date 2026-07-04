'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  ProgressBar,
  Text,
} from '@shopify/polaris';

import { showToast } from '@/components/Providers';
import {
  api,
  type BillingInvoice,
  type BillingPlanResponse,
  type PlanDefinition,
  type UsageSnapshot,
} from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';

function priceLabel(plan: PlanDefinition): string {
  if (plan.priceMonthlyUsd == null) return 'Custom';
  if (plan.priceMonthlyUsd === 0) return 'Free';
  return `${formatCurrency(plan.priceMonthlyUsd)}/mo`;
}

function resolutionLabel(plan: PlanDefinition): string {
  if (plan.aiResolutionsPerMonth == null) return 'Unlimited AI resolutions';
  return `${plan.aiResolutionsPerMonth.toLocaleString()} AI resolutions / month`;
}

function usagePercent(usage: UsageSnapshot | null): number {
  if (!usage || usage.limit == null || usage.limit <= 0) return 0;
  return Math.min(100, Math.round((usage.used / usage.limit) * 100));
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingPlanResponse | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [plan, invoiceData] = await Promise.all([
        api.getBillingPlan(),
        api.getBillingInvoices(),
      ]);
      setBilling(plan);
      setInvoices(invoiceData.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === '1') {
      void load().then(() => {
        showToast('Subscription status refreshed');
        params.delete('billing');
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
        window.history.replaceState({}, '', next);
      });
    }
  }, [load]);

  const usage = billing?.usage ?? null;
  const percent = usagePercent(usage);
  const progressTone =
    usage?.hardLimited || percent >= 100
      ? 'critical'
      : usage?.softWarning || percent >= 80
        ? 'highlight'
        : 'primary';

  const featureRows = useMemo(() => {
    const plans = billing?.plans ?? [];
    return [
      {
        label: 'AI resolutions / month',
        values: plans.map((plan) =>
          plan.aiResolutionsPerMonth == null
            ? 'Unlimited'
            : String(plan.aiResolutionsPerMonth),
        ),
      },
      {
        label: 'Human agents',
        values: plans.map((plan) =>
          plan.features.maxHumanAgents == null
            ? 'Unlimited'
            : String(plan.features.maxHumanAgents),
        ),
      },
      {
        label: 'Proactive triggers',
        values: plans.map((plan) =>
          plan.features.proactiveTriggers ? 'Yes' : '—',
        ),
      },
      {
        label: 'Analytics retention',
        values: plans.map(
          (plan) => `${plan.features.analyticsRetentionDays} days`,
        ),
      },
      {
        label: 'Advanced analytics',
        values: plans.map((plan) =>
          plan.features.advancedAnalytics ? 'Yes' : '—',
        ),
      },
      {
        label: 'Priority support',
        values: plans.map((plan) =>
          plan.features.prioritySupport ? 'Yes' : '—',
        ),
      },
    ];
  }, [billing?.plans]);

  const changePlan = async (planId: string) => {
    setLoadingPlan(planId);
    try {
      const result = await api.upgradePlan(planId);
      if (result.confirmationUrl) {
        window.open(result.confirmationUrl, '_top');
        showToast('Complete approval in Shopify to finish (prorated)');
      } else {
        showToast(result.message ?? 'Plan updated');
        await load();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upgrade failed', true);
    } finally {
      setLoadingPlan(null);
    }
  };

  const cancelPlan = async () => {
    setLoadingPlan('cancel');
    try {
      await api.cancelBilling();
      showToast('Subscription cancelled — you are on Free');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cancel failed', true);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <Page
      title="Billing"
      subtitle={
        billing
          ? `Current plan: ${billing.plan.name}`
          : 'Plans, usage, and invoices'
      }
      secondaryActions={[{ content: 'Refresh', onAction: () => void load() }]}
    >
      <BlockStack gap="500">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        {usage?.softWarning ? (
          <Banner tone="warning">
            You have used {percent}% of this month&apos;s AI resolutions.
            {usage.inGracePeriod
              ? ` Free-tier grace period ends ${usage.gracePeriodEndsAt ? formatDate(usage.gracePeriodEndsAt) : 'soon'}.`
              : ' Upgrade to avoid interruption.'}
          </Banner>
        ) : null}

        {usage?.hardLimited ? (
          <Banner tone="critical">
            AI resolutions are paused for this billing period. Customers see a
            human-only message until you upgrade or the period resets.
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Usage this month
            </Text>
            <InlineStack align="space-between">
              <Text as="span">
                {usage?.used ?? 0}
                {usage?.limit != null ? ` / ${usage.limit}` : ' / Unlimited'} AI
                resolutions
              </Text>
              <Text as="span" tone="subdued">
                {usage?.periodKey ?? '—'}
                {usage?.remaining != null
                  ? ` · ${usage.remaining} remaining`
                  : ''}
              </Text>
            </InlineStack>
            {usage?.limit != null ? (
              <ProgressBar
                progress={percent}
                tone={progressTone}
                size="small"
              />
            ) : (
              <ProgressBar progress={8} tone="primary" size="small" />
            )}
            <Text as="p" tone="subdued">
              Only AI-resolved conversations count. Human-handled chats are
              free.
            </Text>
            {billing?.subscription.trialEndsAt ? (
              <Text as="p">
                Trial ends {formatDate(billing.subscription.trialEndsAt)}
              </Text>
            ) : null}
          </BlockStack>
        </Card>

        <div className="nova-grid nova-grid--stats">
          {(billing?.plans ?? []).map((plan) => {
            const current = billing?.planTier === plan.id;
            return (
              <Card key={plan.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      {plan.name}
                    </Text>
                    {current ? (
                      <Text as="span" tone="success">
                        Current
                      </Text>
                    ) : null}
                  </InlineStack>
                  <Text as="p" variant="headingLg">
                    {priceLabel(plan)}
                  </Text>
                  <Text as="p" tone="subdued">
                    {plan.description}
                  </Text>
                  <Text as="p">{resolutionLabel(plan)}</Text>
                  {plan.trialDays > 0 ? (
                    <Text as="p" tone="success">
                      {plan.trialDays}-day free trial
                    </Text>
                  ) : null}
                  <Text as="p" tone="subdued">
                    {plan.features.maxHumanAgents == null
                      ? 'Unlimited agents'
                      : `${plan.features.maxHumanAgents} human agents`}
                    {' · '}
                    {plan.features.analyticsRetentionDays}d analytics
                  </Text>
                  {plan.id === 'enterprise' ? (
                    <Button disabled>Contact sales</Button>
                  ) : current && plan.id !== 'free' ? (
                    <Button
                      tone="critical"
                      loading={loadingPlan === 'cancel'}
                      onClick={() => void cancelPlan()}
                    >
                      Cancel subscription
                    </Button>
                  ) : current ? (
                    <Button disabled>Current plan</Button>
                  ) : (
                    <Button
                      variant="primary"
                      loading={loadingPlan === plan.id}
                      onClick={() => void changePlan(plan.id)}
                    >
                      {plan.priceMonthlyUsd === 0
                        ? 'Downgrade'
                        : billing &&
                            (billing.plans.findIndex(
                              (p) => p.id === billing.planTier,
                            ) ?? 0) >
                              (billing.plans.findIndex(
                                (p) => p.id === plan.id,
                              ) ?? 0)
                          ? 'Downgrade'
                          : 'Upgrade'}
                    </Button>
                  )}
                </BlockStack>
              </Card>
            );
          })}
        </div>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Feature comparison
            </Text>
            <div className="nova-billing-table">
              <div className="nova-billing-table__row nova-billing-table__row--head">
                <span>Feature</span>
                {(billing?.plans ?? []).map((plan) => (
                  <span key={plan.id}>{plan.name}</span>
                ))}
              </div>
              {featureRows.map((row) => (
                <div key={row.label} className="nova-billing-table__row">
                  <span>{row.label}</span>
                  {row.values.map((value, index) => (
                    <span key={`${row.label}-${index}`}>{value}</span>
                  ))}
                </div>
              ))}
            </div>
            <Text as="p" tone="subdued">
              Plan changes are prorated immediately through Shopify Billing.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Invoice history
            </Text>
            {invoices.length === 0 ? (
              <Text as="p" tone="subdued">
                No Shopify subscription charges yet.
              </Text>
            ) : (
              invoices.map((invoice) => (
                <InlineStack key={invoice.id} align="space-between">
                  <BlockStack gap="100">
                    <Text as="span">{invoice.name}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {formatDate(invoice.createdAt)} · {invoice.status}
                      {invoice.currentPeriodEnd
                        ? ` · period ends ${formatDate(invoice.currentPeriodEnd)}`
                        : ''}
                    </Text>
                  </BlockStack>
                  <Text as="span">
                    {invoice.price != null
                      ? formatCurrency(invoice.price)
                      : '—'}
                  </Text>
                </InlineStack>
              ))
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
