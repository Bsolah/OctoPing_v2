import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';

import type { WsClientMessage, WsServerMessage } from '@nova/shared';

import { prisma } from '@/lib/prisma';
import {
  verifyShopifySession,
  verifyWidgetToken,
  type AuthPrincipal,
} from '@/plugins/auth';
import { getSession } from '@/lib/redis';

import {
  clearAgentPresence,
  getMerchantPresence,
  setAgentPresence,
} from './presence';
import {
  broadcast,
  conversationRoom,
  getSocketMeta,
  joinRoom,
  leaveRoom,
  merchantRoom,
  registerSocket,
  unregisterSocket,
} from './rooms';

async function authenticateToken(token: string): Promise<AuthPrincipal | null> {
  const session = await getSession(token);
  if (session) {
    return {
      type: 'redis_session',
      merchantId: session.merchantId,
      shopDomain: session.shopDomain,
      userId: session.userId,
    };
  }

  return (
    (await verifyShopifySession(token)) ?? (await verifyWidgetToken(token))
  );
}

function send(socket: WebSocket, message: WsServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

const websocketRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { token?: string; agentId?: string };
  }>('/ws', { websocket: true }, (connection, request) => {
    // @fastify/websocket may pass SocketStream or WebSocket depending on version
    const socket = (
      'socket' in connection
        ? (connection as { socket: WebSocket }).socket
        : connection
    ) as WebSocket;
    void handleSocket(socket, request).catch((error) => {
      request.log.error({ err: error }, 'WebSocket connection failed');
      socket.close();
    });
  });
};

async function handleSocket(
  socket: WebSocket,
  request: {
    query: { token?: string; agentId?: string };
    log: { error: (obj: unknown, msg: string) => void };
  },
): Promise<void> {
  const token = request.query.token;
  if (!token) {
    send(socket, { type: 'error', message: 'Missing token', code: 'auth' });
    socket.close();
    return;
  }

  const auth = await authenticateToken(token);
  if (!auth) {
    send(socket, { type: 'error', message: 'Invalid token', code: 'auth' });
    socket.close();
    return;
  }

  const role =
    auth.type === 'widget'
      ? 'customer'
      : request.query.agentId
        ? 'agent'
        : 'merchant';

  registerSocket(socket, {
    merchantId: auth.merchantId,
    role,
    agentId: request.query.agentId,
  });

  if (role === 'agent' || role === 'merchant') {
    joinRoom(socket, merchantRoom(auth.merchantId));
    if (request.query.agentId) {
      await setAgentPresence(auth.merchantId, request.query.agentId, 'online');
      const agents = await getMerchantPresence(auth.merchantId);
      broadcast(merchantRoom(auth.merchantId), {
        type: 'presence',
        merchantId: auth.merchantId,
        agents,
      } satisfies WsServerMessage);
    }
  }

  socket.on('message', (raw) => {
    void (async () => {
      let message: WsClientMessage;
      try {
        message = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      const meta = getSocketMeta(socket);
      if (!meta) return;

      try {
        switch (message.type) {
          case 'ping':
            send(socket, { type: 'pong' });
            break;

          case 'join': {
            if (message.room.startsWith('conversation:')) {
              const conversationId = message.room.slice('conversation:'.length);
              const conversation = await prisma.conversation.findUnique({
                where: { id: conversationId },
              });
              if (
                !conversation ||
                conversation.merchantId !== meta.merchantId
              ) {
                send(socket, {
                  type: 'error',
                  message: 'Forbidden room',
                  code: 'forbidden',
                });
                break;
              }
              joinRoom(socket, message.room);
              send(socket, { type: 'joined', room: message.room });
            } else if (
              message.room === merchantRoom(meta.merchantId) &&
              meta.role !== 'customer'
            ) {
              joinRoom(socket, message.room);
              send(socket, { type: 'joined', room: message.room });
            } else {
              send(socket, {
                type: 'error',
                message: 'Forbidden room',
                code: 'forbidden',
              });
            }
            break;
          }

          case 'leave':
            leaveRoom(socket, message.room);
            send(socket, { type: 'left', room: message.room });
            break;

          case 'typing_start':
          case 'typing_stop': {
            const room = conversationRoom(message.conversationId);
            broadcast(
              room,
              {
                type: 'typing',
                conversationId: message.conversationId,
                actorId: meta.agentId ?? meta.role,
                isTyping: message.type === 'typing_start',
              } satisfies WsServerMessage,
              socket,
            );
            break;
          }

          case 'presence_update': {
            if (!meta.agentId || meta.role === 'customer') {
              send(socket, {
                type: 'error',
                message: 'Only agents can update presence',
              });
              break;
            }
            await setAgentPresence(
              meta.merchantId,
              meta.agentId,
              message.status,
            );
            const agents = await getMerchantPresence(meta.merchantId);
            broadcast(merchantRoom(meta.merchantId), {
              type: 'presence',
              merchantId: meta.merchantId,
              agents,
            } satisfies WsServerMessage);
            break;
          }

          case 'chat_message': {
            // Chat messages should go through REST for persistence + AI.
            // Relay only for human agents typing into an open conversation.
            if (meta.role === 'customer') {
              send(socket, {
                type: 'error',
                message: 'Customers must use REST /messages endpoint',
              });
              break;
            }

            const conversation = await prisma.conversation.findFirst({
              where: {
                id: message.conversationId,
                merchantId: meta.merchantId,
              },
            });
            if (!conversation) {
              send(socket, {
                type: 'error',
                message: 'Conversation not found',
                code: 'not_found',
              });
              break;
            }

            const saved = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                senderType: 'human',
                senderId: meta.agentId,
                content: message.content,
              },
            });

            broadcast(conversationRoom(conversation.id), {
              type: 'chat_message',
              conversationId: conversation.id,
              messageId: saved.id,
              senderType: 'human',
              content: saved.content,
              createdAt: saved.createdAt.toISOString(),
            } satisfies WsServerMessage);
            break;
          }

          default:
            send(socket, { type: 'error', message: 'Unknown message type' });
        }
      } catch (error) {
        request.log.error({ err: error }, 'WebSocket message handling failed');
        send(socket, { type: 'error', message: 'Internal error' });
      }
    })();
  });

  socket.on('close', () => {
    void (async () => {
      const meta = getSocketMeta(socket);
      unregisterSocket(socket);
      if (meta?.agentId) {
        await clearAgentPresence(meta.merchantId, meta.agentId);
        const agents = await getMerchantPresence(meta.merchantId);
        broadcast(merchantRoom(meta.merchantId), {
          type: 'presence',
          merchantId: meta.merchantId,
          agents,
        } satisfies WsServerMessage);
      }
    })();
  });
}

export default websocketRoutes;

export { broadcast, conversationRoom, merchantRoom };
