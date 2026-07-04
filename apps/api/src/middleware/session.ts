import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { getSession, type SessionData } from '@/lib/redis';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionData;
  }
}

function isHealthCheck(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? '';
  return path === '/health' || path.startsWith('/health/');
}

const sessionPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request, reply) => {
    if (isHealthCheck(request)) {
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: {
          message: 'Missing or invalid Authorization header',
          statusCode: 401,
        },
      });
    }

    const sessionId = authorization.slice('Bearer '.length).trim();
    if (!sessionId) {
      return reply.status(401).send({
        error: {
          message: 'Missing session token',
          statusCode: 401,
        },
      });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return reply.status(401).send({
        error: {
          message: 'Invalid or expired session',
          statusCode: 401,
        },
      });
    }

    request.session = session;
  });
};

export default fp(sessionPlugin, {
  name: 'session',
});
