import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { getLogger } from '@/lib/observability';
import { checkRateLimit } from '@/lib/redis';
import { detectSuspiciousRequest } from '@/lib/security';

const MAX_BODY_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const AUTH_RATE_MAX = 5;
const AUTH_RATE_WINDOW_SECONDS = 15 * 60;

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || request.ip;
  }
  return request.ip;
}

function isHealthPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === '/health' || path.startsWith('/health/');
}

function isAuthPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return (
    path.startsWith('/auth') ||
    path.startsWith('/api/auth') ||
    path.includes('/login') ||
    path.includes('/session')
  );
}

function allowedOrigins(): string[] {
  const origins = new Set<string>();

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.DASHBOARD_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }

  for (const origin of (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (trimmed) {
      origins.add(trimmed);
    }
  }

  origins.add('https://admin.shopify.com');

  if (process.env.NODE_ENV === 'development') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3002');
  }

  return [...origins];
}

const securityPlugin: FastifyPluginAsync = async (app) => {
  const origins = allowedOrigins();

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: {
      maxAge: 63_072_000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (origins.includes(origin) || origin.endsWith('.myshopify.com')) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
    maxAge: 86_400,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (isHealthPath(request.url)) {
      return;
    }

    const suspicious = detectSuspiciousRequest([request.url]);

    if (suspicious) {
      getLogger().warn(
        {
          ip: getClientIp(request),
          path: request.url,
          pattern: suspicious,
        },
        'Blocked suspicious request pattern',
      );
      return reply.status(400).send({
        error: {
          message: 'Malformed request',
          statusCode: 400,
        },
      });
    }

    if (isAuthPath(request.url)) {
      const ip = getClientIp(request);
      const result = await checkRateLimit(
        `ratelimit:auth:${ip}`,
        AUTH_RATE_MAX,
        AUTH_RATE_WINDOW_SECONDS,
      );

      reply.header('X-RateLimit-Limit', AUTH_RATE_MAX);
      reply.header('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        const retryAfter = Math.max(
          1,
          Math.ceil((result.resetAt - Date.now()) / 1000),
        );
        reply.header('Retry-After', retryAfter);
        return reply.status(429).send({
          error: {
            message: 'Too many authentication attempts',
            statusCode: 429,
          },
        });
      }
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (
      request.method === 'GET' ||
      request.method === 'HEAD' ||
      request.method === 'OPTIONS'
    ) {
      return;
    }

    const contentLength = request.headers['content-length'];
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return reply.status(413).send({
        error: {
          message: 'Request body too large',
          statusCode: 413,
        },
      });
    }

    if (request.body && typeof request.body === 'object') {
      const serialized = JSON.stringify(request.body);
      const hit = detectSuspiciousRequest([serialized]);
      if (hit) {
        getLogger().warn(
          { ip: getClientIp(request), path: request.url, pattern: hit },
          'Blocked suspicious request body',
        );
        return reply.status(400).send({
          error: {
            message: 'Malformed request',
            statusCode: 400,
          },
        });
      }
    }
  });

  // Enforce max request duration
  app.addHook('onRequest', async (request, reply) => {
    const timer = setTimeout(() => {
      if (!reply.sent) {
        reply.status(504).send({
          error: {
            message: 'Request timeout',
            statusCode: 504,
          },
        });
      }
    }, REQUEST_TIMEOUT_MS);

    reply.raw.on('close', () => {
      clearTimeout(timer);
    });
  });
};

export default fp(securityPlugin, {
  name: 'security',
});

export { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS };
