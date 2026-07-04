'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

type UseAIAssistOptions = {
  conversationId: string | null;
  draft?: string;
  enabled?: boolean;
  debounceMs?: number;
};

type UseAIAssistResult = {
  suggestions: string[];
  loading: boolean;
  error: string | null;
  latencyMs: number | null;
  refresh: () => Promise<void>;
};

/**
 * Fetch AI reply suggestions as the agent reads or types.
 * Targets <1s responses via the fast suggest endpoint.
 */
export function useAIAssist({
  conversationId,
  draft = '',
  enabled = true,
  debounceMs = 350,
}: UseAIAssistOptions): UseAIAssistResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const requestId = useRef(0);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId || !enabled) {
      setSuggestions([]);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const data = await api.suggestReply(conversationId, draft);
      if (id !== requestId.current) return;
      setSuggestions(data.suggestions.slice(0, 3));
      setLatencyMs(data.latencyMs ?? null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Suggestions failed');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, [conversationId, draft, enabled]);

  useEffect(() => {
    if (!conversationId || !enabled) {
      setSuggestions([]);
      return;
    }

    if (timer.current != null) {
      window.clearTimeout(timer.current);
    }

    timer.current = window.setTimeout(() => {
      void refresh();
    }, debounceMs);

    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
      }
    };
  }, [conversationId, draft, debounceMs, enabled, refresh]);

  return {
    suggestions,
    loading,
    error,
    latencyMs,
    refresh,
  };
}
