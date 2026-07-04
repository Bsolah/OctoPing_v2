import { createRoot, type Root } from 'react-dom/client';

import { ChatWidget } from './ChatWidget';
import type { WidgetConfig } from './types';
import widgetCss from './styles.css?inline';

function ensureStyles(): void {
  if (document.querySelector('style[data-nova-widget-css]')) {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-nova-widget-css', 'true');
  style.textContent = widgetCss;
  document.head.appendChild(style);
}

export type NovaWidgetMountOptions = {
  merchantId: string;
  apiUrl: string;
  token: string;
  target?: HTMLElement | string;
  overrides?: Partial<WidgetConfig>;
};

let root: Root | null = null;

function resolveTarget(target?: HTMLElement | string): HTMLElement {
  if (target instanceof HTMLElement) {
    return target;
  }
  if (typeof target === 'string') {
    const el = document.querySelector(target);
    if (el instanceof HTMLElement) {
      return el;
    }
  }

  const existing = document.getElementById('nova-support-widget-root');
  if (existing) {
    return existing;
  }

  const host = document.createElement('div');
  host.id = 'nova-support-widget-root';
  document.body.appendChild(host);
  return host;
}

/**
 * Mount the Nova Support chat widget.
 * Styles are scoped under `.nova-widget` to avoid host-page conflicts.
 */
export function mountNovaWidget(options: NovaWidgetMountOptions): void {
  ensureStyles();
  const host = resolveTarget(options.target);

  if (!root) {
    root = createRoot(host);
  }

  root.render(
    <ChatWidget
      merchantId={options.merchantId}
      apiUrl={options.apiUrl}
      token={options.token}
      overrides={options.overrides}
    />,
  );
}

export function unmountNovaWidget(): void {
  root?.unmount();
  root = null;
}

function autoMountFromScript(): void {
  const script =
    document.currentScript ??
    document.querySelector<HTMLScriptElement>('script[data-merchant-id]');

  if (!(script instanceof HTMLScriptElement)) {
    return;
  }

  const merchantId = script.dataset.merchantId;
  const apiUrl = script.dataset.apiUrl ?? script.dataset.api ?? '';
  const token = script.dataset.token ?? '';

  if (!merchantId || !apiUrl || !token) {
    console.error(
      '[NovaWidget] data-merchant-id, data-api-url, and data-token are required',
    );
    return;
  }

  const mount = () =>
    mountNovaWidget({
      merchantId,
      apiUrl,
      token,
      overrides: {
        title: script.dataset.title,
        greeting: script.dataset.greeting,
        primaryColor: script.dataset.primaryColor,
        position:
          script.dataset.position === 'bottom-left'
            ? 'bottom-left'
            : 'bottom-right',
      },
    });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}

autoMountFromScript();

export { ChatWidget };
export type { WidgetConfig };
