'use client';

import { Badge, IndexTable, Text } from '@shopify/polaris';
import { useRouter } from 'next/navigation';

import type { ConversationSummary } from '@/lib/api';
import { formatDate, statusTone } from '@/lib/format';

type Props = {
  conversation: ConversationSummary;
  selected?: boolean;
  position: number;
};

export function ConversationRow({ conversation, selected, position }: Props) {
  const router = useRouter();
  const preview = conversation.messages?.[0]?.content ?? '—';

  return (
    <IndexTable.Row
      id={conversation.id}
      position={position}
      selected={selected}
      onClick={() => router.push(`/conversations/${conversation.id}`)}
    >
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {conversation.customerEmail ?? 'Anonymous'}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(conversation.status)}>
          {conversation.status}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{conversation.channel}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="subdued" truncate>
          {preview}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(conversation.createdAt)}</IndexTable.Cell>
    </IndexTable.Row>
  );
}
