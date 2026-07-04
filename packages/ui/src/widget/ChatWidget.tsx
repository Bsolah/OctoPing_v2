import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { useConversation } from './hooks/useConversation';
import { useWidgetConfig } from './hooks/useWidgetConfig';
import { MessageBubble } from './MessageBubble';
import type { WidgetConfig } from './types';

type Props = {
  merchantId: string;
  apiUrl: string;
  token: string;
  overrides?: Partial<WidgetConfig>;
};

function TypingIndicator() {
  return (
    <div
      className="nova-typing"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

export function ChatWidget({ merchantId, apiUrl, token, overrides }: Props) {
  const { config } = useWidgetConfig({
    merchantId,
    apiUrl,
    token,
    overrides,
  });

  const {
    messages,
    typing,
    error,
    sending,
    sendMessage,
    sendTyping,
    addSystemMessage,
    pushMessage,
  } = useConversation(config);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [proactiveShown, setProactiveShown] = useState(false);
  const panelId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const isProductPage =
    typeof window !== 'undefined' &&
    /\/products\//i.test(window.location.pathname);

  useEffect(() => {
    if (!isProductPage || proactiveShown || open) {
      return;
    }
    const timer = window.setTimeout(() => {
      setProactiveShown(true);
      setOpen(true);
      addSystemMessage('Can I help you find something?');
    }, config.proactiveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    addSystemMessage,
    config.proactiveDelayMs,
    isProductPage,
    open,
    proactiveShown,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        launcherRef.current?.focus();
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], textarea, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, typing, open]);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setDraft('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    sendTyping(false);
    await sendMessage(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSubmit();
    }
  };

  const handleOrderLookup = (email: string, orderNumber: string) => {
    void sendMessage(`Please look up order ${orderNumber} for ${email}`);
  };

  const handleAddToCart = (productId: string) => {
    void sendMessage(`Please add product ${productId} to my cart`);
  };

  const showOrderLookup = () => {
    setOpen(true);
    pushMessage({
      role: 'ai',
      kind: 'order_lookup',
      content: 'Order lookup',
    });
  };

  const showSuggestions =
    open && messages.filter((m) => m.role !== 'system').length === 0;

  return (
    <div
      className={`nova-widget nova-widget--${config.position}`}
      data-nova-widget="true"
    >
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="nova-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`${config.title} chat`}
        >
          <header className="nova-header">
            <div className="nova-header__brand">
              {config.logoUrl ? (
                <img
                  src={config.logoUrl}
                  alt=""
                  className="nova-header__logo"
                />
              ) : (
                <span className="nova-header__logo nova-header__logo--fallback" />
              )}
              <div>
                <h2 className="nova-header__title">{config.title}</h2>
                <p className="nova-header__subtitle">
                  Usually replies instantly
                </p>
              </div>
            </div>
            <button
              type="button"
              className="nova-icon-btn"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            className="nova-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.length === 0 ? (
              <div className="nova-msg nova-msg--ai">
                <div className="nova-bubble">{config.greeting}</div>
              </div>
            ) : null}

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onAddToCart={handleAddToCart}
                onOrderLookup={handleOrderLookup}
              />
            ))}

            {typing ? <TypingIndicator /> : null}
            {error ? (
              <p className="nova-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {showSuggestions ? (
            <div className="nova-suggestions" aria-label="Suggested replies">
              {config.suggestedReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  className="nova-chip"
                  onClick={() => {
                    if (reply.toLowerCase().includes('track')) {
                      showOrderLookup();
                      return;
                    }
                    void sendMessage(reply);
                  }}
                >
                  {reply}
                </button>
              ))}
            </div>
          ) : null}

          <form className="nova-composer" onSubmit={(e) => void onSubmit(e)}>
            <label className="nova-sr-only" htmlFor={`${panelId}-input`}>
              Message
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              className="nova-textarea"
              rows={1}
              value={draft}
              placeholder="Type a message…"
              onChange={(event) => {
                setDraft(event.target.value);
                resizeInput();
                sendTyping(event.target.value.length > 0);
              }}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <button
              type="submit"
              className="nova-send"
              aria-label="Send message"
              disabled={sending || !draft.trim()}
            >
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        className="nova-launcher"
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '×' : '💬'}
      </button>
    </div>
  );
}
