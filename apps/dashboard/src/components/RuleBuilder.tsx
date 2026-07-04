'use client';

import { useState } from 'react';
import {
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';

export type Rule = {
  id: string;
  ifField: string;
  ifOperator: string;
  ifValue: string;
  thenAction: string;
  thenValue: string;
};

type Props = {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
};

const IF_FIELDS = [
  { label: 'Intent', value: 'intent' },
  { label: 'Sentiment', value: 'sentiment' },
  { label: 'Order value', value: 'order_value' },
  { label: 'Channel', value: 'channel' },
];

const OPERATORS = [
  { label: 'equals', value: 'eq' },
  { label: 'contains', value: 'contains' },
  { label: 'greater than', value: 'gt' },
];

const ACTIONS = [
  { label: 'Escalate', value: 'escalate' },
  { label: 'Set tone', value: 'set_tone' },
  { label: 'Tag conversation', value: 'tag' },
  { label: 'Offer discount', value: 'offer_discount' },
];

export function RuleBuilder({ rules, onChange }: Props) {
  const [draft, setDraft] = useState<Omit<Rule, 'id'>>({
    ifField: 'intent',
    ifOperator: 'eq',
    ifValue: '',
    thenAction: 'escalate',
    thenValue: '',
  });

  const addRule = () => {
    if (!draft.ifValue.trim()) return;
    onChange([
      ...rules,
      {
        id: `rule_${Date.now()}`,
        ...draft,
      },
    ]);
    setDraft((prev) => ({ ...prev, ifValue: '', thenValue: '' }));
  };

  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        Rules builder
      </Text>
      <Card>
        <FormLayout>
          <InlineStack gap="300" wrap>
            <div style={{ minWidth: 140 }}>
              <Select
                label="IF"
                options={IF_FIELDS}
                value={draft.ifField}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, ifField: value }))
                }
              />
            </div>
            <div style={{ minWidth: 140 }}>
              <Select
                label="Operator"
                labelHidden
                options={OPERATORS}
                value={draft.ifOperator}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, ifOperator: value }))
                }
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <TextField
                label="Value"
                labelHidden
                autoComplete="off"
                value={draft.ifValue}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, ifValue: value }))
                }
              />
            </div>
          </InlineStack>
          <InlineStack gap="300" wrap>
            <div style={{ minWidth: 140 }}>
              <Select
                label="THEN"
                options={ACTIONS}
                value={draft.thenAction}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, thenAction: value }))
                }
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <TextField
                label="Action value"
                labelHidden
                autoComplete="off"
                value={draft.thenValue}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, thenValue: value }))
                }
              />
            </div>
            <Button onClick={addRule} variant="primary">
              Add rule
            </Button>
          </InlineStack>
        </FormLayout>
      </Card>

      <BlockStack gap="200">
        {rules.map((rule) => (
          <Card key={rule.id}>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p">
                IF <strong>{rule.ifField}</strong> {rule.ifOperator}{' '}
                <strong>{rule.ifValue}</strong> THEN{' '}
                <strong>{rule.thenAction}</strong>{' '}
                {rule.thenValue ? `(${rule.thenValue})` : ''}
              </Text>
              <Button
                tone="critical"
                variant="plain"
                onClick={() =>
                  onChange(rules.filter((item) => item.id !== rule.id))
                }
              >
                Remove
              </Button>
            </InlineStack>
          </Card>
        ))}
        {rules.length === 0 ? (
          <Text as="p" tone="subdued">
            No rules yet. Add an IF/THEN rule above.
          </Text>
        ) : null}
      </BlockStack>
    </BlockStack>
  );
}
