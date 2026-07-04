'use client';

import {
  Badge,
  BlockStack,
  Card,
  Collapsible,
  Text,
  Button,
} from '@shopify/polaris';
import { useState } from 'react';

import { formatDate } from '@/lib/format';

type Props = {
  senderType: string;
  content: string;
  createdAt: string;
  aiConfidence?: number | null;
  aiIntent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function MessageBubble({
  senderType,
  content,
  createdAt,
  aiConfidence,
  aiIntent,
  metadata,
}: Props) {
  const [open, setOpen] = useState(false);
  const isAi = senderType === 'ai';

  return (
    <Card>
      <BlockStack gap="200">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Badge
            tone={
              senderType === 'customer'
                ? 'info'
                : senderType === 'ai'
                  ? 'success'
                  : 'attention'
            }
          >
            {senderType}
          </Badge>
          <Text as="span" tone="subdued" variant="bodySm">
            {formatDate(createdAt)}
          </Text>
        </div>
        <Text as="p">{content}</Text>
        {isAi ? (
          <>
            <Button
              variant="plain"
              onClick={() => setOpen((value) => !value)}
              ariaExpanded={open}
            >
              {open ? 'Hide AI reasoning' : 'Show AI reasoning'}
            </Button>
            <Collapsible open={open} id={`ai-reasoning-${createdAt}`}>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  Intent: {aiIntent ?? 'n/a'}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Confidence:{' '}
                  {aiConfidence != null
                    ? `${(aiConfidence * 100).toFixed(0)}%`
                    : 'n/a'}
                </Text>
                {metadata ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {JSON.stringify(metadata)}
                  </Text>
                ) : null}
              </BlockStack>
            </Collapsible>
          </>
        ) : null}
      </BlockStack>
    </Card>
  );
}
