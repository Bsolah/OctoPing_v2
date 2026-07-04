import { getShopifyAppUrl } from './config';

function getMerchantDomains(): string[] {
  return (process.env.MERCHANT_DOMAINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  const appUrl = getShopifyAppUrl();
  if (appUrl) {
    try {
      if (origin === new URL(appUrl).origin) {
        return true;
      }
    } catch {
      // ignore invalid SHOPIFY_APP_URL
    }
  }

  if (getMerchantDomains().includes(origin)) {
    return true;
  }

  // Shopify Admin and store admin origins
  if (
    origin === 'https://admin.shopify.com' ||
    origin.endsWith('.myshopify.com')
  ) {
    return true;
  }

  return false;
}

export function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization,Content-Type,X-API-Key,X-Request-ID,X-Shopify-Access-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
