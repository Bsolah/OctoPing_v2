'use client';

import { Card, Text, BlockStack, InlineStack, Badge } from '@shopify/polaris';

type Props = {
  title: string;
  value: string;
  subtitle?: string;
  trend?: string;
  tone?: 'success' | 'attention' | 'critical' | 'info';
};

export function StatCard({ title, value, subtitle, trend, tone }: Props) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="bodyMd" tone="subdued">
          {title}
        </Text>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="headingXl">
            {value}
          </Text>
          {trend ? <Badge tone={tone}>{trend}</Badge> : null}
        </InlineStack>
        {subtitle ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}
