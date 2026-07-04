import type { FastifyPluginAsync } from 'fastify';

import fp from 'fastify-plugin';

import { isPublicApiPath } from '@/lib/public-routes';
import { getSession } from '@/lib/redis';

const sessionPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request, reply) => {
    if (isPublicApiPath(request.url)) {
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
