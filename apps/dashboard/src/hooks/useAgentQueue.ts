'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  type AgentPresenceStatus,
  type AgentProfile,
  type AgentQueueItem,
} from '@/lib/api';

type UseAgentQueueResult = {
  agent: AgentProfile | null;
  items: AgentQueueItem[];
  loading: boolean;
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setStatus: (status: AgentPresenceStatus) => Promise<void>;
  claim: (conversationId: string) => Promise<void>;
};

async function resolveWsToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return (
    window.sessionStorage.getItem('nova_dashboard_token') ??
    process.env.NEXT_PUBLIC_DEV_TOKEN ??
    null
  );
}

export function useAgentQueue(): UseAgentQueueResult {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [items, setItems] = useState<AgentQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [me, queue] = await Promise.all([
        api.getAgentMe(),
        api.getAgentQueue(),
      ]);
      setAgent(me);
      setItems(queue.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current != null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      void refresh();
    }, 150);
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retryMs = 1000;

    async function connect() {
      try {
        const token = await resolveWsToken();
        if (!token || closed) return;

        const wsUrl = `${api.getWsUrl()}/ws?token=${encodeURIComponent(token)}`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          if (closed) return;
          setConnected(true);
          retryMs = 1000;
        };

        socket.onclose = () => {
          if (closed) return;
          setConnected(false);
          window.setTimeout(() => void connect(), retryMs);
          retryMs = Math.min(retryMs * 2, 10_000);
        };

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { type?: string };
            if (
              message.type === 'chat_message' ||
              message.type === 'presence' ||
              message.type === 'ai_done'
            ) {
              scheduleRefresh();
            }
          } catch {
            scheduleRefresh();
          }
        };
      } catch {
        if (!closed) {
          window.setTimeout(() => void connect(), retryMs);
        }
      }
    }

    void connect();

    return () => {
      closed = true;
      socket?.close();
      if (refreshTimer.current != null) {
        window.clearTimeout(refreshTimer.current);
      }
    };
  }, [scheduleRefresh]);

  const setStatus = useCallback(
    async (status: AgentPresenceStatus) => {
      await api.setAgentStatus(status);
      await refresh();
    },
    [refresh],
  );

  const claim = useCallback(
    async (conversationId: string) => {
      await api.claimConversation(conversationId);
      await refresh();
    },
    [refresh],
  );

  return {
    agent,
    items,
    loading,
    connected,
    error,
    refresh,
    setStatus,
    claim,
  };
}
