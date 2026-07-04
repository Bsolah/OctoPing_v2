'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';

import { RichTextEditor } from '@/components/RichTextEditor';
import { showToast } from '@/components/Providers';
import { api, type KnowledgeBaseEntry } from '@/lib/api';

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeBaseEntry[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState('faq');
  const [content, setContent] = useState('<p></p>');
  const [autoSync, setAutoSync] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.listKnowledgeBase();
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KB');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q),
    );
  }, [items, query]);

  const createEntry = async () => {
    if (!title.trim() || !content.replace(/<[^>]+>/g, '').trim()) {
      showToast('Title and content are required', true);
      return;
    }
    try {
      await api.createKnowledgeBase({
        title: title.trim(),
        contentType,
        content,
      });
      setTitle('');
      setContent('<p></p>');
      showToast('Knowledge entry added');
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', true);
    }
  };

  const removeEntry = async (id: string) => {
    try {
      await api.deleteKnowledgeBase(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      showToast('Entry removed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nova-knowledge-base.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as KnowledgeBaseEntry[];
      for (const entry of parsed) {
        await api.createKnowledgeBase({
          title: entry.title,
          contentType: entry.contentType,
          content: entry.content,
        });
      }
      showToast(`Imported ${parsed.length} entries`);
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', true);
    }
  };

  return (
    <Page
      title="Knowledge base"
      primaryAction={{
        content: 'Save entry',
        onAction: () => void createEntry(),
      }}
      secondaryActions={[
        { content: 'Export', onAction: exportJson },
        {
          content: autoSync ? 'Auto-sync on' : 'Auto-sync off',
          onAction: () => {
            setAutoSync((value) => !value);
            showToast(autoSync ? 'Auto-sync disabled' : 'Auto-sync enabled');
          },
        },
      ]}
    >
      <div className="nova-grid nova-grid--detail">
        <BlockStack gap="400">
          {error ? <Banner tone="critical">{error}</Banner> : null}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                New entry
              </Text>
              <TextField
                label="Title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
              />
              <Select
                label="Type"
                options={[
                  { label: 'FAQ', value: 'faq' },
                  { label: 'Policy', value: 'policy' },
                  { label: 'Product', value: 'product' },
                  { label: 'Shipping', value: 'shipping' },
                ]}
                value={contentType}
                onChange={setContentType}
              />
              <Text as="p" variant="bodyMd">
                Content
              </Text>
              <RichTextEditor value={content} onChange={setContent} />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <TextField
                label="Search entries"
                value={query}
                onChange={setQuery}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setQuery('')}
              />
              {filtered.map((item) => (
                <Card key={item.id}>
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        {item.title}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {item.contentType}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {item.content.replace(/<[^>]+>/g, ' ').slice(0, 160)}
                      </Text>
                    </BlockStack>
                    <Button
                      tone="critical"
                      variant="plain"
                      onClick={() => void removeEntry(item.id)}
                    >
                      Delete
                    </Button>
                  </InlineStack>
                </Card>
              ))}
              {filtered.length === 0 ? (
                <Text as="p" tone="subdued">
                  No entries found.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </BlockStack>

        <BlockStack gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                AI-suggested topics
              </Text>
              {[
                'Shipping delays FAQ',
                'Size guide for apparel',
                'Return window exceptions',
                'Gift card redemption',
              ].map((topic) => (
                <InlineStack key={topic} align="space-between">
                  <Text as="span">{topic}</Text>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setTitle(topic);
                      setContentType('faq');
                    }}
                  >
                    Use
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Import
              </Text>
              <input
                type="file"
                accept="application/json"
                aria-label="Import knowledge base JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                }}
              />
              <Text as="p" tone="subdued" variant="bodySm">
                Auto-sync Shopify pages: {autoSync ? 'enabled' : 'disabled'}
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
  );
}
