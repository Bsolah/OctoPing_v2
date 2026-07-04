import type { FastifyPluginAsync } from 'fastify';

import {
  CreateConversationSchema,
  EscalateConversationSchema,
  ListConversationsSchema,
  SendMessageSchema,
} from '@nova/shared';

import { Prisma } from '@prisma/client';

import { runConversationAi } from '@/lib/ai-runner';
import { trackEvent } from '@/lib/analytics/events';
import { enforceAiUsage, recordAiResolutionUsage } from '@/lib/billing/usage';
import { escalateConversation } from '@/lib/escalation/router';
import { resolveMerchant } from '@/lib/merchant-context';
import { prisma } from '@/lib/prisma';
import { parseBody, parseQuery } from '@/lib/validate';

import { broadcast, conversationRoom, merchantRoom } from '@/websocket/handler';

const conversationsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/conversations', async (request, reply) => {
    const body = parseBody(CreateConversationSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        merchantId: merchant.id,
        channel: body.channel,
        customerEmail: body.customerEmail,
        customerShopifyId: body.customerShopifyId
          ? BigInt(body.customerShopifyId)
          : null,
        visitorId: body.visitorId,
        cartProductIds: body.cartProductIds ?? [],
        cartValueAtStart:
          body.cartValueAtStart != null ? body.cartValueAtStart : null,
        messages: body.initialMessage
          ? {
              create: {
                senderType: 'customer',
                content: body.initialMessage,
              },
            }
          : undefined,
      },
      include: { messages: true },
    });

    trackEvent(merchant.id, 'conversation_started', {
      conversationId: conversation.id,
      visitorId: body.visitorId,
      channel: body.channel,
      cartProductIds: body.cartProductIds,
      cartValueAtStart: body.cartValueAtStart,
    });

    broadcast(merchantRoom(merchant.id), {
      type: 'chat_message',
      conversationId: conversation.id,
      messageId: conversation.messages[0]?.id ?? conversation.id,
      senderType: 'customer',
      content: body.initialMessage ?? '',
      createdAt: conversation.createdAt.toISOString(),
    });

    return reply.status(201).send({
      id: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      customerEmail: conversation.customerEmail,
      messages: conversation.messages,
      createdAt: conversation.createdAt,
    });
  });

  app.get('/api/v1/conversations', async (request, reply) => {
    const query = parseQuery(ListConversationsSchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const where = {
      merchantId: merchant.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              {
                customerEmail: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
              {
                messages: {
                  some: {
                    content: {
                      contains: query.q,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20),
        take: query.pageSize ?? 20,
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/conversations/:id',
    async (request, reply) => {
      const merchant = await resolveMerchant(request.auth);
      if (!merchant) {
        return reply.status(404).send({
          error: { message: 'Merchant not found', statusCode: 404 },
        });
      }

      const conversation = await prisma.conversation.findFirst({
        where: { id: request.params.id, merchantId: merchant.id },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      return conversation;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/conversations/:id/messages',
    async (request, reply) => {
      const body = parseBody(SendMessageSchema, request.body, reply);
      if (!body) return;

      const merchant = await resolveMerchant(request.auth);
      if (!merchant) {
        return reply.status(404).send({
          error: { message: 'Merchant not found', statusCode: 404 },
        });
      }

      const conversation = await prisma.conversation.findFirst({
        where: { id: request.params.id, merchantId: merchant.id },
      });
      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      const customerMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: request.auth.type === 'widget' ? 'customer' : 'human',
          senderId: request.auth.userId ?? request.auth.agentId,
          content: body.content,
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      broadcast(conversationRoom(conversation.id), {
        type: 'chat_message',
        conversationId: conversation.id,
        messageId: customerMessage.id,
        senderType: customerMessage.senderType as 'customer' | 'human',
        content: customerMessage.content,
        createdAt: customerMessage.createdAt.toISOString(),
      });

      // Human agent messages pause AI but keep it in transcript context
      if (request.auth.type !== 'widget' && request.auth.type !== 'api_key') {
        if (!conversation.aiPaused) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { aiPaused: true },
          });
        }
        return {
          customerMessage,
          aiMessage: null,
          aiPaused: true,
        };
      }

      // When a human has taken over, AI stays paused but remains in history
      if (conversation.aiPaused) {
        return {
          customerMessage,
          aiMessage: null,
          aiPaused: true,
        };
      }

      const usageGate = await enforceAiUsage(merchant.id);
      if (!usageGate.allowed && usageGate.message) {
        const aiMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'ai',
            content: usageGate.message,
            aiIntent: 'usage_limit',
            metadata: {
              usageLimited: true,
              usage: usageGate.usage,
            } as Prisma.InputJsonValue,
          },
        });

        broadcast(conversationRoom(conversation.id), {
          type: 'chat_message',
          conversationId: conversation.id,
          messageId: aiMessage.id,
          senderType: 'ai',
          content: aiMessage.content,
          createdAt: aiMessage.createdAt.toISOString(),
        });

        return {
          customerMessage,
          aiMessage,
          aiPaused: false,
          usageLimited: true,
          usage: usageGate.usage,
        };
      }

      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const writeEvent = (event: string, data: unknown) => {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        writeEvent('customer_message', customerMessage);

        try {
          const aiStarted = Date.now();
          const aiResult = await runConversationAi({
            merchant,
            conversationId: conversation.id,
            message: body.content,
          });

          const aiMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderType: 'ai',
              content: aiResult.response,
              aiConfidence: aiResult.confidence,
              aiIntent: aiResult.intent,
              metadata: {
                actions: aiResult.actions,
                sources: aiResult.sources,
              } as Prisma.InputJsonValue,
            },
          });

          trackEvent(merchant.id, 'ai_response', {
            conversationId: conversation.id,
            responseMs: Date.now() - aiStarted,
            intent: aiResult.intent,
            confidence: aiResult.confidence,
            softWarning: usageGate.softWarning,
          });

          if (aiResult.escalationPackage) {
            await escalateConversation(conversation.id, {
              sentiment: aiResult.sentiment,
              toolsUsed: aiResult.toolsCalled,
            });
          } else {
            void recordAiResolutionUsage(conversation.id).catch(
              () => undefined,
            );
          }

          // Simulate token stream for SSE clients

          const tokens = aiResult.response.split(/(\s+)/);
          for (const token of tokens) {
            writeEvent('ai_token', { token });
            broadcast(conversationRoom(conversation.id), {
              type: 'ai_token',
              conversationId: conversation.id,
              token,
            });
          }

          writeEvent('ai_done', aiMessage);
          broadcast(conversationRoom(conversation.id), {
            type: 'ai_done',
            conversationId: conversation.id,
            messageId: aiMessage.id,
            content: aiMessage.content,
          });
          broadcast(conversationRoom(conversation.id), {
            type: 'chat_message',
            conversationId: conversation.id,
            messageId: aiMessage.id,
            senderType: 'ai',
            content: aiMessage.content,
            createdAt: aiMessage.createdAt.toISOString(),
          });
        } catch (error) {
          writeEvent('error', {
            message:
              error instanceof Error ? error.message : 'AI processing failed',
          });
        }

        reply.raw.end();
        return;
      }

      const aiStarted = Date.now();
      const aiResult = await runConversationAi({
        merchant,
        conversationId: conversation.id,
        message: body.content,
      });

      const aiMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'ai',
          content: aiResult.response,
          aiConfidence: aiResult.confidence,
          aiIntent: aiResult.intent,
          metadata: {
            actions: aiResult.actions,
            sources: aiResult.sources,
          } as Prisma.InputJsonValue,
        },
      });

      trackEvent(merchant.id, 'ai_response', {
        conversationId: conversation.id,
        responseMs: Date.now() - aiStarted,
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        softWarning: usageGate.softWarning,
      });

      if (aiResult.escalationPackage) {
        await escalateConversation(conversation.id, {
          sentiment: aiResult.sentiment,
          toolsUsed: aiResult.toolsCalled,
        });
      } else {
        void recordAiResolutionUsage(conversation.id).catch(() => undefined);
      }

      broadcast(conversationRoom(conversation.id), {
        type: 'chat_message',
        conversationId: conversation.id,
        messageId: aiMessage.id,
        senderType: 'ai',
        content: aiMessage.content,
        createdAt: aiMessage.createdAt.toISOString(),
      });

      return { customerMessage, aiMessage };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/conversations/:id/escalate',
    async (request, reply) => {
      const body = parseBody(EscalateConversationSchema, request.body, reply);
      if (!body) return;

      const merchant = await resolveMerchant(request.auth);
      if (!merchant) {
        return reply.status(404).send({
          error: { message: 'Merchant not found', statusCode: 404 },
        });
      }

      const conversation = await prisma.conversation.findFirst({
        where: { id: request.params.id, merchantId: merchant.id },
      });
      if (!conversation) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }

      const result = await escalateConversation(conversation.id, {
        reason: body.reason,
        actorId: request.auth.userId ?? request.auth.agentId,
      });

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'system',
          content: body.reason
            ? `Escalated: ${body.reason}`
            : 'Conversation escalated to a human agent',
        },
      });

      return result;
    },
  );
};

export default conversationsRoutes;
