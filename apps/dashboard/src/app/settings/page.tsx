'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Page,
  RangeSlider,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';

import { AgentInviteModal } from '@/components/AgentInviteModal';
import { RuleBuilder, type Rule } from '@/components/RuleBuilder';
import { showToast } from '@/components/Providers';
import { api, type MerchantProfile } from '@/lib/api';

export default function SettingsPage() {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [agents, setAgents] = useState<
    Array<{ email: string; name: string; role: string }>
  >([]);

  const [primaryColor, setPrimaryColor] = useState('#4f46e5');
  const [position, setPosition] = useState('bottom-right');
  const [logoUrl, setLogoUrl] = useState('');
  const [greeting, setGreeting] = useState('Hi! How can we help?');
  const [aiTone, setAiTone] = useState('friendly_professional');
  const [threshold, setThreshold] = useState(0.7);
  const [proactiveSeconds, setProactiveSeconds] = useState(60);
  const [rules, setRules] = useState<Rule[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const profile = await api.getMerchant();
      setMerchant(profile);
      const widget = profile.widgetConfig ?? {};
      setPrimaryColor(String(widget.primaryColor ?? '#4f46e5'));
      setPosition(String(widget.position ?? 'bottom-right'));
      setLogoUrl(String(widget.logoUrl ?? ''));
      setGreeting(String(widget.greeting ?? 'Hi! How can we help?'));
      setAiTone(profile.aiTone);
      setThreshold(profile.escalationThreshold);
      setProactiveSeconds(Number(widget.proactiveDelayMs ?? 60000) / 1000);
      const storedRules = Array.isArray(widget.rules)
        ? (widget.rules as Rule[])
        : [];
      setRules(storedRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: {
    aiTone?: string;
    escalationThreshold?: number;
    widgetConfig?: Record<string, unknown>;
    rules?: string[];
  }) => {
    if (!merchant) return;
    const previous = merchant;
    const nextWidget = {
      ...merchant.widgetConfig,
      ...(patch.widgetConfig ?? {}),
    };
    setMerchant({
      ...merchant,
      aiTone: patch.aiTone ?? merchant.aiTone,
      escalationThreshold:
        patch.escalationThreshold ?? merchant.escalationThreshold,
      widgetConfig: nextWidget,
    });

    try {
      await api.updateSettings({
        aiTone: patch.aiTone,
        escalationThreshold: patch.escalationThreshold,
        widgetConfig: nextWidget,
        rules: patch.rules,
      });
      showToast('Settings saved');
    } catch (err) {
      setMerchant(previous);
      showToast(err instanceof Error ? err.message : 'Save failed', true);
    }
  };

  const persistWidget = (partial: Record<string, unknown>) => {
    void save({
      widgetConfig: {
        primaryColor,
        position,
        logoUrl,
        greeting,
        proactiveDelayMs: proactiveSeconds * 1000,
        rules,
        ...partial,
      },
    });
  };

  return (
    <Page title="Settings">
      <BlockStack gap="500">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Widget customization
            </Text>
            <FormLayout>
              <TextField
                label="Primary color"
                type="text"
                value={primaryColor}
                onChange={(value) => {
                  setPrimaryColor(value);
                  persistWidget({ primaryColor: value });
                }}
                autoComplete="off"
                prefix={
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(event) => {
                      setPrimaryColor(event.target.value);
                      persistWidget({ primaryColor: event.target.value });
                    }}
                    aria-label="Color picker"
                  />
                }
              />
              <Select
                label="Position"
                options={[
                  { label: 'Bottom right', value: 'bottom-right' },
                  { label: 'Bottom left', value: 'bottom-left' },
                ]}
                value={position}
                onChange={(value) => {
                  setPosition(value);
                  persistWidget({ position: value });
                }}
              />
              <TextField
                label="Logo URL"
                value={logoUrl}
                onChange={(value) => {
                  setLogoUrl(value);
                  persistWidget({ logoUrl: value });
                }}
                autoComplete="off"
              />
              <TextField
                label="Greeting"
                value={greeting}
                onChange={(value) => {
                  setGreeting(value);
                  persistWidget({ greeting: value });
                }}
                autoComplete="off"
              />
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              AI behavior
            </Text>
            <Select
              label="Tone"
              options={[
                {
                  label: 'Friendly professional',
                  value: 'friendly_professional',
                },
                { label: 'Casual', value: 'casual' },
                { label: 'Formal', value: 'formal' },
                { label: 'Empathetic', value: 'empathetic' },
              ]}
              value={aiTone}
              onChange={(value) => {
                setAiTone(value);
                void save({ aiTone: value });
              }}
            />
            <RangeSlider
              label={`Escalation threshold (${threshold.toFixed(2)})`}
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0]! : value;
                setThreshold(next);
                void save({ escalationThreshold: next });
              }}
              output
            />
            <RangeSlider
              label={`Proactive trigger (${proactiveSeconds}s on product pages)`}
              min={15}
              max={180}
              step={5}
              value={proactiveSeconds}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0]! : value;
                setProactiveSeconds(next);
                persistWidget({ proactiveDelayMs: next * 1000 });
              }}
              output
            />
          </BlockStack>
        </Card>

        <Card>
          <RuleBuilder
            rules={rules}
            onChange={(next) => {
              setRules(next);
              persistWidget({ rules: next });
            }}
          />
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Team management
              </Text>
              <Button onClick={() => setInviteOpen(true)}>Invite agent</Button>
            </InlineStack>
            {agents.map((agent) => (
              <InlineStack key={agent.email} align="space-between">
                <Text as="span">
                  {agent.name} ({agent.email})
                </Text>
                <Text as="span" tone="subdued">
                  {agent.role} · Mon–Fri 9–5
                </Text>
              </InlineStack>
            ))}
            {agents.length === 0 ? (
              <Text as="p" tone="subdued">
                No agents invited yet.
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>

      <AgentInviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={async (payload) => {
          setAgents((prev) => [...prev, payload]);
          showToast(`Invite sent to ${payload.email}`);
        }}
      />
    </Page>
  );
}
