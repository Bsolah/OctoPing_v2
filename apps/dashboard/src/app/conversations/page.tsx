'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Select,
  useIndexResourceState,
} from '@shopify/polaris';

import { ConversationRow } from '@/components/ConversationRow';
import { showToast } from '@/components/Providers';
import { api, type ConversationSummary } from '@/lib/api';

export default function ConversationsPage() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (status !== 'all') params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      const data = await api.getConversations(params.toString());
      let next = data.items;
      if (channel !== 'all') {
        next = next.filter((item) => item.channel === channel);
      }
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [channel, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    async function connect() {
      try {
        const token =
          window.sessionStorage.getItem('nova_dashboard_token') ??
          process.env.NEXT_PUBLIC_DEV_TOKEN;
        if (!token) return;
        const wsUrl = `${api.getWsUrl()}/ws?token=${encodeURIComponent(token)}`;
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
          if (!closed) setConnected(true);
        };
        socket.onclose = () => {
          if (!closed) {
            setConnected(false);
            window.setTimeout(() => void connect(), 2000);
          }
        };
        socket.onmessage = () => {
          void load();
        };
      } catch {
        // ignore ws failures in dashboard list
      }
    }

    void connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [load]);

  const resourceId = useMemo(
    () => items.map((item) => ({ id: item.id })),
    [items],
  );
  const { selectedResources, handleSelectionChange, clearSelection } =
    useIndexResourceState(resourceId);

  const bulkClose = async () => {
    try {
      await Promise.all(
        selectedResources.map((id) => api.escalate(id, 'Bulk closed')),
      );
      showToast(`Updated ${selectedResources.length} conversations`);
      clearSelection();
      void load();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Bulk action failed',
        true,
      );
    }
  };

  return (
    <Page
      title="Conversations"
      subtitle={connected ? 'Live updates connected' : 'Connecting…'}
      primaryAction={{ content: 'Refresh', onAction: () => void load() }}
    >
      <BlockStack gap="400">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        <Filters
          queryValue={query}
          queryPlaceholder="Search email or message"
          onQueryChange={setQuery}
          onQueryClear={() => setQuery('')}
          onClearAll={() => {
            setQuery('');
            setStatus('all');
            setChannel('all');
          }}
          filters={[]}
        >
          <InlineStack gap="300">
            <div style={{ minWidth: 160 }}>
              <Select
                label="Status"
                labelHidden
                options={[
                  { label: 'All statuses', value: 'all' },
                  { label: 'Active', value: 'active' },
                  { label: 'Escalated', value: 'escalated' },
                  { label: 'Resolved', value: 'resolved' },
                  { label: 'Closed', value: 'closed' },
                ]}
                value={status}
                onChange={setStatus}
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select
                label="Channel"
                labelHidden
                options={[
                  { label: 'All channels', value: 'all' },
                  { label: 'Widget', value: 'widget' },
                  { label: 'Email', value: 'email' },
                  { label: 'Shopify Inbox', value: 'shopify_inbox' },
                ]}
                value={channel}
                onChange={setChannel}
              />
            </div>
          </InlineStack>
        </Filters>

        {selectedResources.length > 0 ? (
          <InlineStack gap="200">
            <Button onClick={() => void bulkClose()}>Close selected</Button>
            <Button onClick={clearSelection}>Clear</Button>
          </InlineStack>
        ) : null}

        <IndexTable
          resourceName={{ singular: 'conversation', plural: 'conversations' }}
          itemCount={items.length}
          selectedItemsCount={selectedResources.length}
          onSelectionChange={handleSelectionChange}
          headings={[
            { title: 'Customer' },
            { title: 'Status' },
            { title: 'Channel' },
            { title: 'Preview' },
            { title: 'Created' },
          ]}
        >
          {items.map((item, index) => (
            <ConversationRow
              key={item.id}
              conversation={item}
              selected={selectedResources.includes(item.id)}
              position={index}
            />
          ))}
        </IndexTable>
      </BlockStack>
    </Page>
  );
}
