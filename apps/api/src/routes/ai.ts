import type { FastifyPluginAsync } from 'fastify';

import { AiFeedbackSchema, AiQuerySchema, AiSuggestSchema } from '@nova/shared';
import { Prisma } from '@prisma/client';

import { runConversationAi } from '@/lib/ai-runner';
import { enforceAiUsage, recordAiResolutionUsage } from '@/lib/billing/usage';
import { resolveMerchant } from '@/lib/merchant-context';
import { prisma } from '@/lib/prisma';
import { parseBody, parseQuery } from '@/lib/validate';

const aiRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/ai/query', async (request, reply) => {
    const body = parseBody(AiQuerySchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    let conversationId = body.conversationId;
    if (conversationId) {
      const existing = await prisma.conversation.findFirst({
        where: { id: conversationId, merchantId: merchant.id },
      });
      if (!existing) {
        return reply.status(404).send({
          error: { message: 'Conversation not found', statusCode: 404 },
        });
      }
    } else {
      const created = await prisma.conversation.create({
        data: {
          merchantId: merchant.id,
          channel: 'widget',
          status: 'active',
        },
      });
      conversationId = created.id;
    }

    await prisma.message.create({
      data: {
        conversationId,
        senderType: 'customer',
        content: body.message,
      },
    });

    const usageGate = await enforceAiUsage(merchant.id);
    if (!usageGate.allowed && usageGate.message) {
      const aiMessage = await prisma.message.create({
        data: {
          conversationId,
          senderType: 'ai',
          content: usageGate.message,
          aiIntent: 'usage_limit',
          metadata: {
            usageLimited: true,
            usage: usageGate.usage,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        conversationId,
        message: aiMessage,
        intent: 'usage_limit',
        confidence: 1,
        actions: [],
        sources: [],
        usageLimited: true,
        usage: usageGate.usage,
      };
    }

    const result = await runConversationAi({
      merchant,
      conversationId,
      message: body.message,
    });

    const aiMessage = await prisma.message.create({
      data: {
        conversationId,
        senderType: 'ai',
        content: result.response,
        aiConfidence: result.confidence,
        aiIntent: result.intent,
        metadata: {
          actions: result.actions,
          sources: result.sources,
          softWarning: usageGate.softWarning,
        } as Prisma.InputJsonValue,
      },
    });

    if (!result.escalationPackage) {
      void recordAiResolutionUsage(conversationId).catch(() => undefined);
    }

    return {
      conversationId,
      message: aiMessage,
      intent: result.intent,
      confidence: result.confidence,
      actions: result.actions,
      sources: result.sources,
      usage: usageGate.usage,
    };
  });

  app.post('/api/v1/ai/feedback', async (request, reply) => {
    const body = parseBody(AiFeedbackSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const message = await prisma.message.findFirst({
      where: {
        id: body.messageId,
        conversationId: body.conversationId,
        conversation: { merchantId: merchant.id },
      },
    });

    if (!message) {
      return reply.status(404).send({
        error: { message: 'Message not found', statusCode: 404 },
      });
    }

    await prisma.event.create({
      data: {
        merchantId: merchant.id,
        conversationId: body.conversationId,
        eventType: 'ai.feedback',
        properties: {
          messageId: body.messageId,
          rating: body.rating,
          comment: body.comment ?? null,
        },
      },
    });

    return { ok: true };
  });

  app.get('/api/v1/ai/suggest', async (request, reply) => {
    const query = parseQuery(AiSuggestSchema, request.query, reply);
    if (!query) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: query.conversationId, merchantId: merchant.id },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 12 },
      },
    });

    if (!conversation) {
      return reply.status(404).send({
        error: { message: 'Conversation not found', statusCode: 404 },
      });
    }

    const started = Date.now();
    const transcript = conversation.messages
      .slice()
      .reverse()
      .map((m) => `${m.senderType}: ${m.content}`)
      .join('\n')
      .slice(-3000);

    const context = conversation.escalationContext as {
      suggestedHumanResponse?: string;
      conversationSummary?: string;
    } | null;

    const defaults = [
      context?.suggestedHumanResponse ??
        'Thanks for your patience — I have the full context and can help from here.',
      'I looked into this and can walk you through the next steps right away.',
      "I'm sorry for the trouble — let me take care of this for you now.",
    ];

    let suggestions = defaults;

    try {
      const { chat, MODELS } = await import('@nova/ai');
      const result = await chat(
        [
          {
            role: 'system',
            content: `You help human support agents. Return ONLY JSON:
{"suggestions":["reply1","reply2","reply3"]}
Each reply is a short, ready-to-send customer message. Tone: ${merchant.aiTone}.`,
          },
          {
            role: 'user',
            content: `Summary: ${context?.conversationSummary ?? 'n/a'}
Transcript:
${transcript}
${query.draft ? `Agent draft so far: ${query.draft}` : ''}`,
          },
        ],
        MODELS.fast.id,
        { merchantId: merchant.id },
      );

      const start = result.content.indexOf('{');
      const end = result.content.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(result.content.slice(start, end + 1)) as {
          suggestions?: string[];
        };
        if (
          Array.isArray(parsed.suggestions) &&
          parsed.suggestions.length >= 3
        ) {
          suggestions = parsed.suggestions.slice(0, 3).map(String);
        }
      }
    } catch {
      // keep defaults for <1s reliability
    }

    return {
      suggestions,
      latencyMs: Date.now() - started,
    };
  });
};

export default aiRoutes;
