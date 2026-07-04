import type { FastifyPluginAsync } from 'fastify';

import { z } from 'zod';

import { assertAgentCanHandle, resolveAgent } from '@/lib/agent-context';
import { attributeRevenue } from '@/lib/analytics/attribution';
import {
  escalateConversation,
  claimNextFromQueue,
} from '@/lib/escalation/router';
import { resolveMerchant } from '@/lib/merchant-context';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validate';
import { getMerchantPresence, setAgentPresence } from '@/websocket/presence';
import { broadcast, conversationRoom, merchantRoom } from '@/websocket/rooms';

const StatusSchema = z.object({
  status: z.enum(['online', 'away', 'busy', 'offline']),
});

const ResolveSchema = z.object({
  releaseToAi: z.boolean().optional().default(false),
  note: z.string().max(2000).optional(),
});

const NoteSchema = z.object({
  body: z.string().min(1).max(4000),
});

const agentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/agents/me', async (request, reply) => {
    const agent = await resolveAgent(request.auth);
    if (!agent) {
      return reply.status(404).send({
        error: { message: 'Agent not found', statusCode: 404 },
      });
    }

    const presence = await getMerchantPresence(agent.merchantId);
    const mine = presence.find((p) => p.agentId === agent.id);

    return {
      id: agent.id,
      email: agent.email,
      name: agent.name,
      role: agent.role,
      avatar: agent.avatar,
      isOnline: agent.isOnline,
      workingHours: agent.workingHours,
      presence: mine?.status ?? (agent.isOnline ? 'online' : 'offline'),
    };
  });

  app.post('/api/v1/agents/status', async (request, reply) => {
    const body = parseBody(StatusSchema, request.body, reply);
    if (!body) return;

    const agent = await resolveAgent(request.auth);
    if (!agent) {
      return reply.status(404).send({
        error: { message: 'Agent not found', statusCode: 404 },
      });
    }
    assertAgentCanHandle(agent.role);

    await prisma.agent.update({
      where: { id: agent.id },
      data: { isOnline: body.status !== 'offline' },
    });

    await setAgentPresence(agent.merchantId, agent.id, body.status);

    if (body.status === 'online') {
      const claimed = await claimNextFromQueue(agent.merchantId, agent.id);
      if (claimed) {
        broadcast(merchantRoom(agent.merchantId), {
          type: 'chat_message',
          conversationId: claimed,
          messageId: claimed,
          senderType: 'system',
          content: 'Queued conversation assigned',
          createdAt: new Date().toISOString(),
        });
      }
    }

    const agents = await getMerchantPresence(agent.merchantId);
    broadcast(merchantRoom(agent.merchantId), {
      type: 'presence',
      merchantId: agent.merchantId,
      agents,
    });

    return { ok: true, status: body.status };
  });

  app.get('/api/v1/agents/queue', async (request, reply) => {
    const agent = await resolveAgent(request.auth);
    if (!agent) {
      return reply.status(404).send({
        error: { message: 'Agent not found', statusCode: 404 },
      });
    }
    assertAgentCanHandle(agent.role);

    const items = await prisma.conversation.findMany({
      where: {
        merchantId: agent.merchantId,
        status: 'escalated',
        OR: [{ assignedAgentId: agent.id }, { assignedAgentId: null }],
      },
      orderBy: [
        { priority: 'desc' },
        { queuedAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return {
      agentId: agent.id,
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        channel: item.channel,
        customerEmail: item.customerEmail,
        priority: item.priority,
        assignedAgentId: item.assignedAgentId,
        queuedAt: item.queuedAt,
        slaDueAt: item.slaDueAt,
        aiPaused: item.aiPaused,
        escalationContext: item.escalationContext,
        preview: item.messages[0]?.content ?? null,
        updatedAt: item.updatedAt,
        createdAt: item.createdAt,
      })),
    };
  });

  app.post<{ Params: { conversationId: string } }>(
    '/api/v1/agents/:conversationId/claim',
    async (request, reply) => {
      const agent = await resolveAgent(request.auth);
      if (!agent) {
        return reply.status(404).send({
          error: { message: 'Agent not found', statusCode: 404 },
        });
      }
      assertAgentCanHandle(agent.role);

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: request.params.conversationId,
          merchantId: agent.merchantId,
          status: 'escalated',
        },
      });
      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      if (
        conversation.assignedAgentId &&
        conversation.assignedAgentId !== agent.id
      ) {
        return reply.status(409).send({
          error: { message: 'Already assigned', statusCode: 409 },
        });
      }

      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          assignedAgentId: agent.id,
          escalatedTo: agent.id,
          aiPaused: true,
          queuedAt: null,
          slaDueAt: null,
        },
      });

      return updated;
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    '/api/v1/agents/:conversationId/resolve',
    async (request, reply) => {
      const body = parseBody(ResolveSchema, request.body, reply);
      if (!body) return;

      const agent = await resolveAgent(request.auth);
      if (!agent) {
        return reply.status(404).send({
          error: { message: 'Agent not found', statusCode: 404 },
        });
      }
      assertAgentCanHandle(agent.role);

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: request.params.conversationId,
          merchantId: agent.merchantId,
        },
      });
      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      if (body.releaseToAi) {
        const updated = await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'active',
            aiPaused: false,
            assignedAgentId: null,
            escalatedTo: null,
            queuedAt: null,
            slaDueAt: null,
            priority: 0,
            endedAt: null,
          },
        });

        if (body.note) {
          await prisma.event.create({
            data: {
              merchantId: agent.merchantId,
              conversationId: conversation.id,
              eventType: 'agent.note',
              properties: { body: body.note, agentId: agent.id },
            },
          });
        }

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'system',
            content: 'Conversation released back to AI',
          },
        });

        broadcast(conversationRoom(conversation.id), {
          type: 'chat_message',
          conversationId: conversation.id,
          messageId: conversation.id,
          senderType: 'system',
          content: 'Conversation released back to AI',
          createdAt: new Date().toISOString(),
        });

        return updated;
      }

      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'resolved',
          aiPaused: true,
          assignedAgentId: agent.id,
          endedAt: new Date(),
          aiResolution: false,
        },
      });

      if (body.note) {
        await prisma.event.create({
          data: {
            merchantId: agent.merchantId,
            conversationId: conversation.id,
            eventType: 'agent.note',
            properties: { body: body.note, agentId: agent.id },
          },
        });
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'system',
          content: 'Conversation resolved by human agent',
        },
      });

      // Attribute within 1h window after conversation ends
      void attributeRevenue(conversation.id).catch(() => undefined);

      broadcast(conversationRoom(conversation.id), {
        type: 'chat_message',
        conversationId: conversation.id,
        messageId: conversation.id,
        senderType: 'system',
        content: 'Conversation resolved',
        createdAt: new Date().toISOString(),
      });

      return updated;
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    '/api/v1/agents/:conversationId/notes',
    async (request, reply) => {
      const body = parseBody(NoteSchema, request.body, reply);
      if (!body) return;

      const agent = await resolveAgent(request.auth);
      if (!agent) {
        return reply.status(404).send({
          error: { message: 'Agent not found', statusCode: 404 },
        });
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: request.params.conversationId,
          merchantId: agent.merchantId,
        },
      });
      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      const note = await prisma.event.create({
        data: {
          merchantId: agent.merchantId,
          conversationId: conversation.id,
          eventType: 'agent.note',
          properties: {
            body: body.body,
            agentId: agent.id,
            agentName: agent.name,
          },
        },
      });

      return note;
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    '/api/v1/agents/:conversationId/notes',
    async (request, reply) => {
      const agent = await resolveAgent(request.auth);
      if (!agent) {
        return reply.status(404).send({
          error: { message: 'Agent not found', statusCode: 404 },
        });
      }

      const notes = await prisma.event.findMany({
        where: {
          merchantId: agent.merchantId,
          conversationId: request.params.conversationId,
          eventType: 'agent.note',
        },
        orderBy: { createdAt: 'asc' },
      });

      return { items: notes };
    },
  );

  app.post('/api/v1/agents/escalate', async (request, reply) => {
    const body = parseBody(
      z.object({
        conversationId: z.string().uuid(),
        reason: z.string().optional(),
        sentiment: z.string().optional(),
      }),
      request.body,
      reply,
    );
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversationId, merchantId: merchant.id },
    });
    if (!conversation) {
      return reply.status(404).send({
        error: { message: 'Conversation not found', statusCode: 404 },
      });
    }

    const agent = await resolveAgent(request.auth);
    const result = await escalateConversation(body.conversationId, {
      reason: body.reason,
      sentiment: body.sentiment,
      actorId: agent?.id,
    });

    return result;
  });
};

export default agentsRoutes;
