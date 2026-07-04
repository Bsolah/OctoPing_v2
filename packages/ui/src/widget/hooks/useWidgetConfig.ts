import { useEffect, useMemo, useState } from 'react';

import type { WidgetConfig, WidgetPosition } from '../types';

type RawConfig = {
  title?: string;
  greeting?: string;
  primaryColor?: string;
  position?: WidgetPosition;
  logoUrl?: string;
  suggestedReplies?: string[];
  proactiveDelayMs?: number;
};

const DEFAULTS: Omit<WidgetConfig, 'merchantId' | 'apiUrl' | 'token'> = {
  title: 'Nova Support',
  greeting: 'Hi! How can we help you today?',
  primaryColor: '#4f46e5',
  position: 'bottom-right',
  suggestedReplies: [
    'Track my order',
    'Return policy',
    'Product recommendations',
  ],
  proactiveDelayMs: 60_000,
};

function applyCssVariables(color: string, position: WidgetPosition) {
  const root = document.documentElement;
  root.style.setProperty('--nova-primary', color);
  root.style.setProperty(
    '--nova-launcher-right',
    position === 'bottom-right' ? '20px' : 'auto',
  );
  root.style.setProperty(
    '--nova-launcher-left',
    position === 'bottom-left' ? '20px' : 'auto',
  );
}

export function useWidgetConfig(options: {
  merchantId: string;
  apiUrl: string;
  token: string;
  overrides?: Partial<WidgetConfig>;
}): { config: WidgetConfig; loading: boolean } {
  const [remote, setRemote] = useState<RawConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(
          `${options.apiUrl.replace(/\/$/, '')}/api/v1/merchant/me`,
          {
            headers: {
              Authorization: `Bearer ${options.token}`,
              Accept: 'application/json',
            },
          },
        );

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          widgetConfig?: RawConfig & Record<string, unknown>;
        };

        if (!cancelled && data.widgetConfig) {
          setRemote(data.widgetConfig as RawConfig);
        }
      } catch {
        // Use defaults when config fetch fails
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [options.apiUrl, options.token]);

  const config = useMemo<WidgetConfig>(() => {
    const merged: WidgetConfig = {
      merchantId: options.merchantId,
      apiUrl: options.apiUrl.replace(/\/$/, ''),
      token: options.token,
      title: options.overrides?.title ?? remote.title ?? DEFAULTS.title,
      greeting:
        options.overrides?.greeting ?? remote.greeting ?? DEFAULTS.greeting,
      primaryColor:
        options.overrides?.primaryColor ??
        remote.primaryColor ??
        DEFAULTS.primaryColor,
      position:
        options.overrides?.position ?? remote.position ?? DEFAULTS.position,
      logoUrl: options.overrides?.logoUrl ?? remote.logoUrl,
      suggestedReplies:
        options.overrides?.suggestedReplies ??
        remote.suggestedReplies ??
        DEFAULTS.suggestedReplies,
      proactiveDelayMs:
        options.overrides?.proactiveDelayMs ??
        remote.proactiveDelayMs ??
        DEFAULTS.proactiveDelayMs,
    };

    applyCssVariables(merged.primaryColor, merged.position);
    return merged;
  }, [options, remote]);

  return { config, loading };
}
