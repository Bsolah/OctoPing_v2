import type { Metadata } from 'next';
import Script from 'next/script';
import '@shopify/polaris/build/esm/styles.css';

import { Providers } from '@/components/Providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'Nova Support',
  description: 'AI-powered customer support for Shopify',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="shopify-api-key"
          content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? ''}
        />
      </head>
      <body>
        <Script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          strategy="beforeInteractive"
        />
        <Providers>
          <div className="nova-page">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
