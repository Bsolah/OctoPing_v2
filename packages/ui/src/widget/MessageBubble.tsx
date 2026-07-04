import type { WidgetMessage } from './types';

function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\n/g, '<br />');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

type Props = {
  message: WidgetMessage;
  onAddToCart?: (productId: string) => void;
  onOrderLookup?: (email: string, orderNumber: string) => void;
};

export function MessageBubble({ message, onAddToCart, onOrderLookup }: Props) {
  const isCustomer = message.role === 'customer';
  const isSystem = message.role === 'system';

  if (message.kind === 'order_lookup') {
    return (
      <div
        className="nova-msg nova-msg--ai"
        role="group"
        aria-label="Order lookup"
      >
        <form
          className="nova-card"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const email = (form.elements.namedItem('email') as HTMLInputElement)
              .value;
            const orderNumber = (
              form.elements.namedItem('orderNumber') as HTMLInputElement
            ).value;
            onOrderLookup?.(email, orderNumber);
          }}
        >
          <p className="nova-card__title">Look up your order</p>
          <label className="nova-label" htmlFor={`email-${message.id}`}>
            Email
          </label>
          <input
            id={`email-${message.id}`}
            name="email"
            type="email"
            required
            className="nova-input"
            autoComplete="email"
          />
          <label className="nova-label" htmlFor={`order-${message.id}`}>
            Order number
          </label>
          <input
            id={`order-${message.id}`}
            name="orderNumber"
            type="text"
            required
            className="nova-input"
            autoComplete="off"
          />
          <button type="submit" className="nova-btn nova-btn--primary">
            Find order
          </button>
        </form>
      </div>
    );
  }

  if (message.kind === 'product' && message.product) {
    const product = message.product;
    return (
      <div className="nova-msg nova-msg--ai" role="article">
        <div className="nova-card nova-card--product">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="nova-card__image"
            />
          ) : (
            <div className="nova-card__image nova-card__image--placeholder" />
          )}
          <div className="nova-card__body">
            <p className="nova-card__title">{product.title}</p>
            {product.price ? (
              <p className="nova-card__price">{product.price}</p>
            ) : null}
            <div className="nova-card__actions">
              {product.url ? (
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nova-btn nova-btn--ghost"
                >
                  View
                </a>
              ) : null}
              {product.productId ? (
                <button
                  type="button"
                  className="nova-btn nova-btn--primary"
                  onClick={() => onAddToCart?.(product.productId!)}
                >
                  Add to Cart
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <time className="nova-msg__time" dateTime={message.createdAt}>
          {formatTime(message.createdAt)}
        </time>
      </div>
    );
  }

  if (message.kind === 'tracking' && message.tracking) {
    const tracking = message.tracking;
    return (
      <div className="nova-msg nova-msg--ai" role="article">
        <div className="nova-card nova-card--tracking">
          <div className="nova-tracking__header">
            <span className="nova-tracking__carrier">
              {tracking.carrier ?? 'Carrier'}
            </span>
            <span className="nova-tracking__status">
              {tracking.status ?? 'In transit'}
            </span>
          </div>
          {tracking.trackingNumber ? (
            <p className="nova-tracking__number">{tracking.trackingNumber}</p>
          ) : null}
          <ol className="nova-timeline">
            {(tracking.timeline ?? []).map((step, index) => (
              <li
                key={`${step.description}-${index}`}
                className="nova-timeline__item"
              >
                <span className="nova-timeline__dot" aria-hidden="true" />
                <div>
                  <p>{step.description}</p>
                  {step.location ? (
                    <p className="nova-muted">{step.location}</p>
                  ) : null}
                  {step.timestamp ? (
                    <time className="nova-muted" dateTime={step.timestamp}>
                      {formatTime(step.timestamp)}
                    </time>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div
            className="nova-map-placeholder"
            role="img"
            aria-label="Map placeholder for delivery location"
          >
            Map preview
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`nova-msg ${isCustomer ? 'nova-msg--customer' : isSystem ? 'nova-msg--system' : 'nova-msg--ai'}`}
      role="article"
      aria-label={`${message.role} message`}
    >
      <div
        className="nova-bubble"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
      />
      <div className="nova-msg__meta">
        <time dateTime={message.createdAt}>
          {formatTime(message.createdAt)}
        </time>
        {message.status === 'sending' ? (
          <span className="nova-msg__status" aria-label="Sending">
            ·
          </span>
        ) : null}
        {message.status === 'error' ? (
          <span className="nova-msg__status nova-msg__status--error">
            Failed
          </span>
        ) : null}
      </div>
    </div>
  );
}
