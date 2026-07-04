'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { useParams } from 'next/navigation';

import { MessageBubble } from '@/components/MessageBubble';
import { showToast } from '@/components/Providers';
import { api, type ConversationDetail } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    null,
  );
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.getConversation(params.id);
      setConversation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const takeOver = async () => {
    try {
      await api.escalate(params.id, 'Agent took over');
      showToast('You took over this conversation');
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Take over failed', true);
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setLoading(true);
    try {
      await api.sendMessage(params.id, reply.trim());
      setReply('');
      showToast('Reply sent');
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send failed', true);
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestion = async () => {
    try {
      const data = await api.suggestReply(params.id);
      setSuggestion(data.suggestions[0] ?? '');
      showToast('Suggestion ready');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Suggest failed', true);
    }
  };

  const addNote = () => {
    if (!note.trim()) return;
    showToast(`Internal note saved: ${note}`);
    setNote('');
  };

  if (!conversation && !error) {
    return <Page title="Conversation">Loading…</Page>;
  }

  return (
    <Page
      title={conversation?.customerEmail ?? 'Conversation'}
      backAction={{ content: 'Conversations', url: '/conversations' }}
      primaryAction={{ content: 'Take over', onAction: () => void takeOver() }}
    >
      <div className="nova-grid nova-grid--detail">
        <BlockStack gap="400">
          {error ? <Banner tone="critical">{error}</Banner> : null}

          <Card>
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
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  Reply
                </Text>
                <Button onClick={() => void loadSuggestion()}>
                  AI suggestions
                </Button>
              </InlineStack>
              {suggestion ? (
                <Banner
                  title="Suggested reply"
                  action={{
                    content: 'Use suggestion',
                    onAction: () => setReply(suggestion),
                  }}
                  onDismiss={() => setSuggestion('')}
                >
                  <p>{suggestion}</p>
                </Banner>
              ) : null}
              <TextField
                label="Message"
                labelHidden
                value={reply}
                onChange={setReply}
                multiline={4}
                autoComplete="off"
              />
              <InlineStack align="end">
                <Button
                  variant="primary"
                  loading={loading}
                  onClick={() => void sendReply()}
                >
                  Send reply
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Internal notes
              </Text>
              <TextField
                label="Note"
                labelHidden
                value={note}
                onChange={setNote}
                placeholder="Add a note for @agent…"
                autoComplete="off"
                multiline={2}
              />
              <InlineStack align="end">
                <Button onClick={addNote}>Save note</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>

        <BlockStack gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Customer
              </Text>
              <Text as="p">{conversation?.customerEmail ?? 'Anonymous'}</Text>
              <Text as="p" tone="subdued">
                Channel: {conversation?.channel}
              </Text>
              <Text as="p" tone="subdued">
                Status: {conversation?.status}
              </Text>
              <Text as="p" tone="subdued">
                Started:{' '}
                {conversation ? formatDate(conversation.createdAt) : '—'}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Orders & LTV
              </Text>
              <Text as="p">
                Revenue impact:{' '}
                {formatCurrency(conversation?.revenueImpact ?? 0)}
              </Text>
              <Text as="p" tone="subdued">
                Order history loads from linked customer email.
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
  );
}
