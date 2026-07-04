import { useCallback, useEffect, useRef, useState } from 'react';

type WsServerMessage =
  | {
      type: 'typing';
      conversationId: string;
      actorId: string;
      isTyping: boolean;
    }
  | {
      type: 'chat_message';
      conversationId: string;
      messageId: string;
      senderType: 'customer' | 'ai' | 'human' | 'system';
      content: string;
      createdAt: string;
    }
  | { type: 'ai_token'; conversationId: string; token: string }
  | {
      type: 'ai_done';
      conversationId: string;
      messageId: string;
      content: string;
    }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' }
  | { type: string; [key: string]: unknown };

import type { WidgetConfig, WidgetMessage } from '../types';

function storageKey(merchantId: string) {
  return `nova-widget-conversation:${merchantId}`;
}

function createId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export function useConversation(config: WidgetConfig) {
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey(config.merchantId));
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const closedRef = useRef(false);

  const persistConversationId = useCallback(
    (id: string) => {
      setConversationId(id);
      try {
        localStorage.setItem(storageKey(config.merchantId), id);
      } catch {
        // ignore quota / private mode
      }
    },
    [config.merchantId],
  );

  const ensureConversation = useCallback(
    async (initialMessage?: string) => {
      if (conversationId) {
        return conversationId;
      }

      const response = await fetch(`${config.apiUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: authHeaders(config.token),
        body: JSON.stringify({
          channel: 'widget',
          initialMessage,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start conversation');
      }

      const data = (await response.json()) as {
        id: string;
        messages?: Array<{
          id: string;
          content: string;
          senderType: string;
          createdAt: string;
        }>;
      };

      persistConversationId(data.id);

      if (data.messages?.length) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role:
              m.senderType === 'customer'
                ? 'customer'
                : m.senderType === 'ai'
                  ? 'ai'
                  : m.senderType === 'human'
                    ? 'human'
                    : 'system',
            kind: 'text',
            content: m.content,
            createdAt: m.createdAt,
            status: 'sent',
          })),
        );
      }

      return data.id;
    },
    [config.apiUrl, config.token, conversationId, persistConversationId],
  );

  const connectWs = useCallback(() => {
    if (closedRef.current || !conversationId) {
      return;
    }

    const wsUrl = config.apiUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const socket = new WebSocket(
      `${wsUrl}/ws?token=${encodeURIComponent(config.token)}`,
    );
    wsRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      retriesRef.current = 0;
      socket.send(
        JSON.stringify({
          type: 'join',
          room: `conversation:${conversationId}`,
        }),
      );
    };

    socket.onmessage = (event) => {
      let payload: WsServerMessage;
      try {
        payload = JSON.parse(String(event.data)) as WsServerMessage;
      } catch {
        return;
      }

      if (payload.type === 'typing') {
        setTyping(payload.isTyping);
        return;
      }

      if (payload.type === 'chat_message') {
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.messageId)) {
            return prev;
          }
          return [
            ...prev,
            {
              id: payload.messageId,
              role:
                payload.senderType === 'customer'
                  ? 'customer'
                  : payload.senderType,
              kind: 'text',
              content: payload.content,
              createdAt: payload.createdAt,
              status: 'sent',
            },
          ];
        });
        setTyping(false);
        return;
      }

      if (payload.type === 'ai_token') {
        setTyping(true);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'ai' && last.id.startsWith('stream_')) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + payload.token },
            ];
          }
          return [
            ...prev,
            {
              id: `stream_${Date.now()}`,
              role: 'ai',
              kind: 'text',
              content: payload.token,
              createdAt: new Date().toISOString(),
              status: 'sending',
            },
          ];
        });
        return;
      }

      if (payload.type === 'ai_done') {
        setTyping(false);
        setMessages((prev) => {
          const withoutStream = prev.filter((m) => !m.id.startsWith('stream_'));
          if (withoutStream.some((m) => m.id === payload.messageId)) {
            return withoutStream;
          }
          return [
            ...withoutStream,
            {
              id: payload.messageId,
              role: 'ai',
              kind: 'text',
              content: payload.content,
              createdAt: new Date().toISOString(),
              status: 'sent',
            },
          ];
        });
      }
    };

    socket.onclose = () => {
      setConnected(false);
      if (closedRef.current) {
        return;
      }
      const attempt = retriesRef.current;
      retriesRef.current += 1;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      window.setTimeout(() => connectWs(), delay);
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [config.apiUrl, config.token, conversationId]);

  useEffect(() => {
    closedRef.current = false;
    if (conversationId) {
      connectWs();
    }
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
    };
  }, [conversationId, connectWs]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let cancelled = false;
    async function loadHistory() {
      try {
        const response = await fetch(
          `${config.apiUrl}/api/v1/conversations/${conversationId}`,
          { headers: authHeaders(config.token) },
        );
        if (!response.ok || cancelled) {
          return;
        }
        const data = (await response.json()) as {
          messages: Array<{
            id: string;
            content: string;
            senderType: string;
            createdAt: string;
            metadata?: {
              sources?: Array<{
                title: string;
                url?: string;
                productId?: string;
              }>;
            };
          }>;
        };
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role:
              m.senderType === 'customer'
                ? 'customer'
                : m.senderType === 'ai'
                  ? 'ai'
                  : m.senderType === 'human'
                    ? 'human'
                    : 'system',
            kind: 'text',
            content: m.content,
            createdAt: m.createdAt,
            status: 'sent',
            product: m.metadata?.sources?.[0]
              ? {
                  title: m.metadata.sources[0].title,
                  url: m.metadata.sources[0].url,
                  productId: m.metadata.sources[0].productId,
                }
              : undefined,
          })),
        );
      } catch {
        // ignore history load errors
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [config.apiUrl, config.token, conversationId]);

  const sendMessage = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || sending) {
        return;
      }

      setSending(true);
      setError(null);

      const optimistic: WidgetMessage = {
        id: createId(),
        role: 'customer',
        kind: 'text',
        content: text,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      setMessages((prev) => [...prev, optimistic]);

      try {
        const id = await ensureConversation(text);
        const response = await fetch(
          `${config.apiUrl}/api/v1/conversations/${id}/messages`,
          {
            method: 'POST',
            headers: authHeaders(config.token),
            body: JSON.stringify({ content: text, stream: true }),
          },
        );

        if (!response.ok) {
          throw new Error('Failed to send message');
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, status: 'sent' } : m,
          ),
        );

        // Consume SSE for AI tokens when available
        if (
          response.headers.get('content-type')?.includes('text/event-stream')
        ) {
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const streamId = `stream_${Date.now()}`;

          if (reader) {
            setTyping(true);
            let streamDone = false;
            while (!streamDone) {
              const { done, value } = await reader.read();
              streamDone = done;
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const chunks = buffer.split('\n\n');
              buffer = chunks.pop() ?? '';

              for (const chunk of chunks) {
                const lines = chunk.split('\n');
                const event = lines
                  .find((l) => l.startsWith('event:'))
                  ?.slice(6)
                  .trim();
                const dataLine = lines
                  .find((l) => l.startsWith('data:'))
                  ?.slice(5)
                  .trim();
                if (!event || !dataLine) continue;

                const data = JSON.parse(dataLine) as Record<string, unknown>;
                if (event === 'ai_token' && typeof data.token === 'string') {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.id === streamId) {
                      return [
                        ...prev.slice(0, -1),
                        { ...last, content: last.content + data.token },
                      ];
                    }
                    return [
                      ...prev,
                      {
                        id: streamId,
                        role: 'ai',
                        kind: 'text',
                        content: data.token,
                        createdAt: new Date().toISOString(),
                        status: 'sending',
                      },
                    ];
                  });
                }
                if (event === 'ai_done') {
                  setTyping(false);
                  const message = data as {
                    id?: string;
                    content?: string;
                    createdAt?: string;
                  };
                  setMessages((prev) => {
                    const withoutStream = prev.filter((m) => m.id !== streamId);
                    if (!message.id || !message.content) {
                      return withoutStream;
                    }
                    return [
                      ...withoutStream,
                      {
                        id: message.id,
                        role: 'ai',
                        kind: 'text',
                        content: message.content,
                        createdAt:
                          message.createdAt ?? new Date().toISOString(),
                        status: 'sent',
                      },
                    ];
                  });
                }
              }
            }
            setTyping(false);
          }
        } else {
          const data = (await response.json()) as {
            aiMessage?: {
              id: string;
              content: string;
              createdAt: string;
            };
          };
          if (data.aiMessage) {
            setMessages((prev) => [
              ...prev,
              {
                id: data.aiMessage!.id,
                role: 'ai',
                kind: 'text',
                content: data.aiMessage!.content,
                createdAt: data.aiMessage!.createdAt,
                status: 'sent',
              },
            ]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, status: 'error' } : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [config.apiUrl, config.token, ensureConversation, sending],
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!conversationId || wsRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }
      wsRef.current.send(
        JSON.stringify({
          type: isTyping ? 'typing_start' : 'typing_stop',
          conversationId,
        }),
      );
    },
    [conversationId],
  );

  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: createId(),
        role: 'system',
        kind: 'system',
        content,
        createdAt: new Date().toISOString(),
        status: 'sent',
      },
    ]);
  }, []);

  const pushMessage = useCallback(
    (
      message: Omit<WidgetMessage, 'id' | 'createdAt'> & {
        id?: string;
        createdAt?: string;
      },
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          id: message.id ?? createId(),
          createdAt: message.createdAt ?? new Date().toISOString(),
          role: message.role,
          kind: message.kind,
          content: message.content,
          status: message.status ?? 'sent',
          product: message.product,
          tracking: message.tracking,
        },
      ]);
    },
    [],
  );

  return {
    conversationId,
    messages,
    connected,
    typing,
    error,
    sending,
    sendMessage,
    sendTyping,
    addSystemMessage,
    pushMessage,
    ensureConversation,
  };
}
