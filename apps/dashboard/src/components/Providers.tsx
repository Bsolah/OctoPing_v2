'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppProvider, Frame, Navigation, Toast } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import {
  HomeIcon,
  ChatIcon,
  EmailIcon,
  ChartVerticalIcon,
  BookIcon,
  CashDollarIcon,
  SettingsIcon,
} from '@shopify/polaris-icons';
import { usePathname, useRouter } from 'next/navigation';

import { setTokenGetter } from '@/lib/api';

type Props = {
  children: React.ReactNode;
};

type ToastState = { content: string; error?: boolean } | null;

export function Providers({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    setTokenGetter(async () => {
      const shopify = (
        window as Window & {
          shopify?: { idToken?: () => Promise<string> };
        }
      ).shopify;

      if (shopify?.idToken) {
        try {
          return await shopify.idToken();
        } catch {
          // fall through
        }
      }

      return (
        window.sessionStorage.getItem('nova_dashboard_token') ??
        process.env.NEXT_PUBLIC_DEV_TOKEN ??
        null
      );
    });

    (
      window as Window & {
        novaToast?: (content: string, error?: boolean) => void;
      }
    ).novaToast = (content, error) => setToast({ content, error });
  }, []);

  const navigation = useMemo(
    () => (
      <Navigation location={pathname}>
        <Navigation.Section
          items={[
            {
              url: '/',
              label: 'Overview',
              icon: HomeIcon,
              selected: pathname === '/',
              onClick: () => router.push('/'),
            },
            {
              url: '/conversations',
              label: 'Conversations',
              icon: ChatIcon,
              selected: pathname.startsWith('/conversations'),
              onClick: () => router.push('/conversations'),
            },
            {
              url: '/inbox',
              label: 'Inbox',
              icon: EmailIcon,
              selected: pathname.startsWith('/inbox'),
              onClick: () => router.push('/inbox'),
            },
            {
              url: '/analytics',
              label: 'Analytics',
              icon: ChartVerticalIcon,
              selected: pathname.startsWith('/analytics'),
              onClick: () => router.push('/analytics'),
            },
            {
              url: '/knowledge-base',
              label: 'Knowledge base',
              icon: BookIcon,
              selected: pathname.startsWith('/knowledge-base'),
              onClick: () => router.push('/knowledge-base'),
            },
            {
              url: '/billing',
              label: 'Billing',
              icon: CashDollarIcon,
              selected: pathname.startsWith('/billing'),
              onClick: () => router.push('/billing'),
            },
            {
              url: '/settings',
              label: 'Settings',
              icon: SettingsIcon,
              selected: pathname.startsWith('/settings'),
              onClick: () => router.push('/settings'),
            },
          ]}
        />
      </Navigation>
    ),
    [pathname, router],
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Frame
        navigation={navigation}
        showMobileNavigation={mobileNav}
        onNavigationDismiss={() => setMobileNav(false)}
      >
        {children}
        {toast ? (
          <Toast
            content={toast.content}
            error={toast.error}
            onDismiss={() => setToast(null)}
          />
        ) : null}
      </Frame>
    </AppProvider>
  );
}

export function showToast(content: string, error = false) {
  if (typeof window === 'undefined') return;
  (
    window as Window & {
      novaToast?: (content: string, error?: boolean) => void;
    }
  ).novaToast?.(content, error);
}
