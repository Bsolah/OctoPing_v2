import { createHmac, timingSafeEqual } from 'crypto';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { isPublicApiPath } from '@/lib/public-routes';
import { getSession } from '@/lib/redis';
import { getShopifyApiSecret } from '@/lib/shopify/config';

export type AuthPrincipal = {
  type: 'shopify_session' | 'widget' | 'api_key' | 'redis_session';
  merchantId: string;
  shopDomain?: string;
  userId?: string;
  agentId?: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthPrincipal;
    /** @deprecated use auth */
    session: {
      merchantId: string;
      shopDomain: string;
      userId?: string;
    };
  }
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function verifyHs256Jwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  if (bytesToBase64Url(signature) !== signatureB64) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64)),
    ) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifies JWT issued for Shopify App Bridge embedded sessions.
 */
export async function verifyShopifySession(
  token: string,
): Promise<AuthPrincipal | null> {
  let secret: string;
  try {
    secret = getShopifyApiSecret();
  } catch {
    return null;
  }

  const payload = await verifyHs256Jwt(token, secret);
  if (!payload) return null;

  const dest =
    typeof payload.dest === 'string'
      ? payload.dest.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : undefined;
  const merchantId =
    typeof payload.merchantId === 'string'
      ? payload.merchantId
      : typeof payload.sub === 'string'
        ? payload.sub
        : undefined;

  // Prefer explicit merchantId claim; fall back to shop domain lookup key
  if (!merchantId && !dest) return null;

  return {
    type: 'shopify_session',
    merchantId: merchantId ?? dest!,
    shopDomain: dest,
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
  };
}

/**
 * Verifies widget session JWT (signed with WIDGET_JWT_SECRET or SHOPIFY_API_SECRET).
 */
export async function verifyWidgetToken(
  token: string,
): Promise<AuthPrincipal | null> {
  const secret =
    process.env.WIDGET_JWT_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;

  const payload = await verifyHs256Jwt(token, secret);
  if (!payload) return null;

  const merchantId =
    typeof payload.merchantId === 'string' ? payload.merchantId : undefined;
  if (!merchantId) return null;

  return {
    type: 'widget',
    merchantId,
    shopDomain:
      typeof payload.shopDomain === 'string' ? payload.shopDomain : undefined,
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
  };
}

/**
 * Verifies Shopify webhook HMAC (raw body must be on request.rawBody).
 */
export function verifyWebhookSignature(request: FastifyRequest): boolean {
  const hmacHeader = request.headers['x-shopify-hmac-sha256'];
  const signature = Array.isArray(hmacHeader) ? hmacHeader[0] : hmacHeader;
  if (!signature) return false;

  let secret: string;
  try {
    secret = getShopifyApiSecret();
  } catch {
    return false;
  }

  const rawBody =
    (request as FastifyRequest & { rawBody?: string }).rawBody ??
    (typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body ?? {}));

  const digest = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function getBearer(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('auth', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request, reply) => {
    if (isPublicApiPath(request.url)) {
      return;
    }

    const apiKey = request.headers['x-api-key'];
    const configuredKey = process.env.GATEWAY_API_KEY;
    if (
      configuredKey &&
      typeof apiKey === 'string' &&
      apiKey === configuredKey
    ) {
      const merchantId = request.headers['x-merchant-id'];
      if (typeof merchantId !== 'string' || !merchantId) {
        return reply.status(401).send({
          error: {
            message: 'X-Merchant-Id required with API key',
            statusCode: 401,
          },
        });
      }
      request.auth = {
        type: 'api_key',
        merchantId,
        shopDomain:
          typeof request.headers['x-shop-domain'] === 'string'
            ? request.headers['x-shop-domain']
            : undefined,
      };
      request.session = {
        merchantId: request.auth.merchantId,
        shopDomain: request.auth.shopDomain ?? '',
      };
      return;
    }

    const token = getBearer(request);
    if (!token) {
      return reply.status(401).send({
        error: {
          message: 'Missing or invalid Authorization header',
          statusCode: 401,
        },
      });
    }

    // Redis session (dashboard)
    const session = await getSession(token);
    if (session) {
      request.auth = {
        type: 'redis_session',
        merchantId: session.merchantId,
        shopDomain: session.shopDomain,
        userId: session.userId,
      };
      request.session = session;
      return;
    }

    // Shopify App Bridge JWT
    const shopifyAuth = await verifyShopifySession(token);
    if (shopifyAuth) {
      request.auth = shopifyAuth;
      request.session = {
        merchantId: shopifyAuth.merchantId,
        shopDomain: shopifyAuth.shopDomain ?? '',
        userId: shopifyAuth.userId,
      };
      return;
    }

    // Widget JWT
    const widgetAuth = await verifyWidgetToken(token);
    if (widgetAuth) {
      request.auth = widgetAuth;
      request.session = {
        merchantId: widgetAuth.merchantId,
        shopDomain: widgetAuth.shopDomain ?? '',
        userId: widgetAuth.userId,
      };
      return;
    }

    return reply.status(401).send({
      error: {
        message: 'Invalid or expired token',
        statusCode: 401,
      },
    });
  });
};

export default fp(authPlugin, {
  name: 'auth',
});
