'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  Collapsible,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';

import { MessageBubble } from '@/components/MessageBubble';
import { showToast } from '@/components/Providers';
import { useAIAssist } from '@/hooks/useAIAssist';
import { useAgentQueue } from '@/hooks/useAgentQueue';
import {
  api,
  type AgentNote,
  type AgentPresenceStatus,
  type AgentQueueItem,
  type ConversationDetail,
  type EscalationContextPackage,
  type MerchantProfile,
} from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';

const DEFAULT_QUICK_REPLIES = [
  'Thanks for reaching out — I am looking into this now.',
  'I am sorry for the inconvenience. Let me fix this for you.',
  'Could you share your order number so I can pull up the details?',
];

function priorityTone(
  label?: EscalationContextPackage['priorityLabel'],
): 'critical' | 'warning' | 'info' | 'success' {
  if (label === 'urgent') return 'critical';
  if (label === 'high') return 'warning';
  if (label === 'medium') return 'info';
  return 'success';
}

function slaLabel(slaDueAt?: string | null): string | null {
  if (!slaDueAt) return null;
  const ms = new Date(slaDueAt).getTime() - Date.now();
  if (ms < 0) return 'SLA breached';
  const mins = Math.ceil(ms / 60_000);
  return `SLA ${mins}m`;
}

export default function InboxPage() {
  const { agent, items, loading, connected, error, refresh, setStatus, claim } =
    useAgentQueue();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    null,
  );
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [reply, setReply] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [contextOpen, setContextOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const context = (selectedItem?.escalationContext ??
    null) as EscalationContextPackage | null;

  const quickReplies = useMemo(() => {
    const configured = merchant?.widgetConfig?.quickReplies;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.map(String);
    }
    return DEFAULT_QUICK_REPLIES;
  }, [merchant]);

  const {
    suggestions,
    loading: suggestionsLoading,
    refresh: refreshSuggestions,
  } = useAIAssist({
    conversationId: selectedId,
    draft: reply,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    void api
      .getMerchant()
      .then(setMerchant)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedId && items[0]) {
      setSelectedId(items[0].id);
    }
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const loadConversation = useCallback(async (id: string) => {
    setDetailError(null);
    try {
      const [detail, noteList] = await Promise.all([
        api.getConversation(id),
        api.getAgentNotes(id),
      ]);
      setConversation(detail);
      setNotes(noteList.items);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      setNotes([]);
      setReply('');
      return;
    }
    void loadConversation(selectedId);
  }, [selectedId, loadConversation]);

  const insertSuggestion = useCallback((text: string) => {
    setReply(text);
  }, []);

  const sendReply = useCallback(async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      if (
        selectedItem &&
        selectedItem.assignedAgentId !== agent?.id &&
        !selectedItem.assignedAgentId
      ) {
        await claim(selectedId);
      }
      await api.sendMessage(selectedId, reply.trim());
      setReply('');
      showToast('Reply sent — AI paused');
      await Promise.all([loadConversation(selectedId), refresh()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send failed', true);
    } finally {
      setSending(false);
    }
  }, [
    agent?.id,
    claim,
    loadConversation,
    refresh,
    reply,
    selectedId,
    selectedItem,
  ]);

  const resolve = useCallback(
    async (releaseToAi: boolean) => {
      if (!selectedId) return;
      try {
        await api.resolveConversation(selectedId, { releaseToAi });
        showToast(
          releaseToAi ? 'Released back to AI' : 'Conversation resolved',
        );
        setSelectedId(null);
        await refresh();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Resolve failed', true);
      }
    },
    [refresh, selectedId],
  );

  const saveNote = useCallback(async () => {
    if (!selectedId || !noteDraft.trim()) return;
    try {
      await api.addAgentNote(selectedId, noteDraft.trim());
      setNoteDraft('');
      const noteList = await api.getAgentNotes(selectedId);
      setNotes(noteList.items);
      showToast('Internal note saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Note failed', true);
    }
  }, [noteDraft, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typingInField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'Enter' &&
        typingInField
      ) {
        event.preventDefault();
        void sendReply();
        return;
      }

      if (typingInField && target?.tagName === 'TEXTAREA') {
        // Allow 1-3 only when not composing long text with modifiers
        if (event.metaKey || event.ctrlKey || event.altKey) return;
      }

      if (!typingInField || target?.tagName === 'TEXTAREA') {
        if (event.key === '1' && suggestions[0] && !event.metaKey) {
          if (!typingInField) {
            event.preventDefault();
            insertSuggestion(suggestions[0]);
          } else if (reply.length === 0) {
            event.preventDefault();
            insertSuggestion(suggestions[0]);
          }
        }
        if (event.key === '2' && suggestions[1] && reply.length === 0) {
          event.preventDefault();
          insertSuggestion(suggestions[1]);
        }
        if (event.key === '3' && suggestions[2] && reply.length === 0) {
          event.preventDefault();
          insertSuggestion(suggestions[2]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [insertSuggestion, reply.length, sendReply, suggestions]);

  const statusOptions = [
    { label: 'Online', value: 'online' },
    { label: 'Away', value: 'away' },
    { label: 'Busy', value: 'busy' },
    { label: 'Offline', value: 'offline' },
  ];

  return (
    <Page
      title="Agent inbox"
      subtitle={
        agent
          ? `${agent.name} · ${agent.role}${connected ? ' · live' : ' · reconnecting'}`
          : 'Human handoff queue'
      }
      primaryAction={{
        content: 'Refresh',
        onAction: () => void refresh(),
      }}
    >
      <div className="nova-inbox">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Queue
              </Text>
              <div style={{ minWidth: 140 }}>
                <Select
                  label="Status"
                  labelHidden
                  options={statusOptions}
                  value={agent?.presence ?? 'offline'}
                  onChange={(value) =>
                    void setStatus(value as AgentPresenceStatus).catch((err) =>
                      showToast(
                        err instanceof Error ? err.message : 'Status failed',
                        true,
                      ),
                    )
                  }
                />
              </div>
            </InlineStack>

            {error ? <Banner tone="critical">{error}</Banner> : null}
            {loading && items.length === 0 ? (
              <Text as="p">Loading queue…</Text>
            ) : null}
            {!loading && items.length === 0 ? (
              <Text as="p" tone="subdued">
                No escalated conversations. You are clear.
              </Text>
            ) : null}

            <div className="nova-inbox-queue">
              {items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  mine={item.assignedAgentId === agent?.id}
                  onSelect={() => setSelectedId(item.id)}
                  onClaim={() =>
                    void claim(item.id)
                      .then(() => {
                        setSelectedId(item.id);
                        showToast('Conversation claimed');
                      })
                      .catch((err) =>
                        showToast(
                          err instanceof Error ? err.message : 'Claim failed',
                          true,
                        ),
                      )
                  }
                />
              ))}
            </div>
          </BlockStack>
        </Card>

        <div className="nova-inbox-main">
          {!selectedId ? (
            <Card>
              <Text as="p" tone="subdued">
                Select a conversation from the queue.
              </Text>
            </Card>
          ) : (
            <BlockStack gap="400">
              {detailError ? (
                <Banner tone="critical">{detailError}</Banner>
              ) : null}

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        {conversation?.customerEmail ??
                          selectedItem?.customerEmail ??
                          'Customer'}
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone={priorityTone(context?.priorityLabel)}>
                          {`P${selectedItem?.priority ?? 0} ${context?.priorityLabel ?? ''}`}
                        </Badge>
                        {selectedItem?.aiPaused ? (
                          <Badge tone="attention">AI paused</Badge>
                        ) : null}
                        {slaLabel(selectedItem?.slaDueAt) ? (
                          <Badge tone="warning">
                            {slaLabel(selectedItem?.slaDueAt) ?? ''}
                          </Badge>
                        ) : null}
                      </InlineStack>
                    </BlockStack>
                    <ButtonGroup>
                      <Button onClick={() => void resolve(true)}>
                        Resolve & release to AI
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void resolve(false)}
                      >
                        Resolve
                      </Button>
                    </ButtonGroup>
                  </InlineStack>

                  <div className="nova-transcript">
                    {conversation?.messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        senderType={message.senderType}
                        content={message.content}
                        createdAt={message.createdAt}
                        aiConfidence={message.aiConfidence}
                        aiIntent={message.aiIntent}
                        metadata={message.metadata}
                      />
                    ))}
                  </div>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">
                      AI suggestions
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => void refreshSuggestions()}
                      loading={suggestionsLoading}
                    >
                      Refresh
                    </Button>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Press 1–3 to insert · ⌘/Ctrl+Enter to send
                  </Text>
                  <div className="nova-inbox-suggestions">
                    {(suggestions.length
                      ? suggestions
                      : [context?.suggestedHumanResponse].filter(Boolean)
                    ).map((text, index) => (
                      <button
                        key={`${index}-${text?.slice(0, 12)}`}
                        type="button"
                        className="nova-inbox-suggestion"
                        onClick={() => insertSuggestion(String(text))}
                      >
                        <span className="nova-inbox-suggestion__key">
                          {index + 1}
                        </span>
                        <span>{text}</span>
                      </button>
                    ))}
                  </div>

                  <Text as="h3" variant="headingSm">
                    Quick replies
                  </Text>
                  <InlineStack gap="200" wrap>
                    {quickReplies.map((template) => (
                      <Button
                        key={template}
                        size="slim"
                        onClick={() => insertSuggestion(template)}
                      >
                        {template.length > 42
                          ? `${template.slice(0, 42)}…`
                          : template}
                      </Button>
                    ))}
                  </InlineStack>

                  <TextField
                    label="Reply"
                    labelHidden
                    value={reply}
                    onChange={setReply}
                    multiline={4}
                    autoComplete="off"
                    placeholder="Write a reply…"
                  />
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      loading={sending}
                      onClick={() => void sendReply()}
                      disabled={!reply.trim()}
                    >
                      Send
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Internal notes
                  </Text>
                  <div className="nova-inbox-notes">
                    {notes.length === 0 ? (
                      <Text as="p" tone="subdued">
                        No internal notes yet.
                      </Text>
                    ) : (
                      notes.map((note) => (
                        <div key={note.id} className="nova-inbox-note">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {note.properties.agentName ?? 'Agent'} ·{' '}
                            {formatDate(note.createdAt)}
                          </Text>
                          <Text as="p">{note.properties.body}</Text>
                        </div>
                      ))
                    )}
                  </div>
                  <TextField
                    label="Add note"
                    labelHidden
                    value={noteDraft}
                    onChange={setNoteDraft}
                    multiline={2}
                    autoComplete="off"
                    placeholder="Visible only to agents…"
                  />
                  <InlineStack align="end">
                    <Button
                      onClick={() => void saveNote()}
                      disabled={!noteDraft.trim()}
                    >
                      Add note
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </div>

        <div className="nova-inbox-sidebar">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  AI context
                </Text>
                <Button
                  variant="plain"
                  onClick={() => setContextOpen((open) => !open)}
                >
                  {contextOpen ? 'Collapse' : 'Expand'}
                </Button>
              </InlineStack>
              <Collapsible open={contextOpen} id="ai-context-panel">
                <BlockStack gap="300">
                  <Text as="p">
                    {context?.conversationSummary ??
                      'Context will appear when this conversation is escalated.'}
                  </Text>
                  {context?.aiReasoningChain?.length ? (
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">
                        AI reasoning
                      </Text>
                      {context.aiReasoningChain.map((step) => (
                        <div key={step.messageId} className="nova-inbox-chain">
                          <Text as="p" variant="bodySm">
                            {step.intent ?? 'unknown'} ·{' '}
                            {step.confidence != null
                              ? `${Math.round(step.confidence * 100)}%`
                              : 'n/a'}
                          </Text>
                          {step.toolsUsed?.length ? (
                            <Text as="p" tone="subdued" variant="bodySm">
                              Tools: {step.toolsUsed.join(', ')}
                            </Text>
                          ) : null}
                          <Text as="p" tone="subdued" variant="bodySm">
                            {step.excerpt}
                          </Text>
                        </div>
                      ))}
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Customer
              </Text>
              <Text as="p">
                {context?.customerProfile?.email ??
                  selectedItem?.customerEmail ??
                  'Unknown'}
              </Text>
              <Text as="p" tone="subdued">
                Orders: {context?.customerProfile?.orderCount ?? 0} · LTV:{' '}
                {formatCurrency(context?.customerProfile?.ltv ?? 0)}
              </Text>
              {context?.customerProfile?.tags?.length ? (
                <InlineStack gap="100" wrap>
                  {context.customerProfile.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </InlineStack>
              ) : null}

              <Text as="h4" variant="headingSm">
                Orders
              </Text>
              {context?.orderHistory?.length ? (
                context.orderHistory.map((order) => (
                  <div key={order.id} className="nova-inbox-order">
                    <Text as="p" variant="bodySm">
                      #{order.shopifyOrderId} ·{' '}
                      {order.totalPrice
                        ? formatCurrency(Number(order.totalPrice))
                        : '—'}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {order.status ?? 'unknown'} ·{' '}
                      {order.trackingStatus ?? 'no tracking'}
                      {order.carrier ? ` (${order.carrier})` : ''}
                    </Text>
                    {order.trackingNumbers?.length ? (
                      <Text as="p" tone="subdued" variant="bodySm">
                        {order.trackingNumbers.join(', ')}
                      </Text>
                    ) : null}
                  </div>
                ))
              ) : (
                <Text as="p" tone="subdued">
                  No orders linked.
                </Text>
              )}
            </BlockStack>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function QueueRow({
  item,
  active,
  mine,
  onSelect,
  onClaim,
}: {
  item: AgentQueueItem;
  active: boolean;
  mine: boolean;
  onSelect: () => void;
  onClaim: () => void;
}) {
  const context = item.escalationContext;
  const label = context?.priorityLabel ?? 'low';

  return (
    <div
      className={`nova-inbox-queue-row${active ? ' is-active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <InlineStack align="space-between" blockAlign="start">
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            {item.customerEmail ?? 'Customer'}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm" truncate>
            {item.preview ?? 'No messages'}
          </Text>
          <InlineStack gap="100">
            <Badge tone={priorityTone(label)}>{`P${item.priority}`}</Badge>
            {mine ? <Badge tone="success">Yours</Badge> : null}
            {!item.assignedAgentId ? (
              <Badge tone="attention">Unassigned</Badge>
            ) : null}
          </InlineStack>
        </BlockStack>
        {!item.assignedAgentId ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Button size="slim" onClick={onClaim}>
              Claim
            </Button>
          </div>
        ) : null}
      </InlineStack>
    </div>
  );
}
