import type { FastifyPluginAsync } from 'fastify';

import {
  CreateKnowledgeBaseSchema,
  UpdateMerchantSettingsSchema,
} from '@nova/shared';
import { Prisma } from '@prisma/client';

import { resolveMerchant } from '@/lib/merchant-context';
import { batchSyncKnowledgeBase } from '@/lib/pinecone';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validate';

const merchantsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/merchant/me', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    return {
      id: merchant.id,
      shopDomain: merchant.shopDomain,
      planTier: merchant.planTier,
      aiTone: merchant.aiTone,
      escalationThreshold: merchant.escalationThreshold,
      aiRules: merchant.aiRules ?? [],
      widgetConfig: merchant.widgetConfig ?? {},
      isActive: merchant.isActive,
      createdAt: merchant.createdAt,
      updatedAt: merchant.updatedAt,
    };
  });

  app.patch('/api/v1/merchant/settings', async (request, reply) => {
    const body = parseBody(UpdateMerchantSettingsSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const updated = await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        ...(body.aiTone ? { aiTone: body.aiTone } : {}),
        ...(body.escalationThreshold != null
          ? { escalationThreshold: body.escalationThreshold }
          : {}),
        ...(body.rules ? { aiRules: body.rules as Prisma.InputJsonValue } : {}),
        ...(body.widgetConfig
          ? { widgetConfig: body.widgetConfig as Prisma.InputJsonValue }
          : {}),
      },
    });

    return {
      id: updated.id,
      aiTone: updated.aiTone,
      escalationThreshold: updated.escalationThreshold,
      aiRules: updated.aiRules ?? [],
      widgetConfig: updated.widgetConfig ?? {},
    };
  });

  app.get('/api/v1/merchant/knowledge-base', async (request, reply) => {
    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const entries = await prisma.knowledgeBase.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });

    return { items: entries };
  });

  app.post('/api/v1/merchant/knowledge-base', async (request, reply) => {
    const body = parseBody(CreateKnowledgeBaseSchema, request.body, reply);
    if (!body) return;

    const merchant = await resolveMerchant(request.auth);
    if (!merchant) {
      return reply.status(404).send({
        error: { message: 'Merchant not found', statusCode: 404 },
      });
    }

    const entry = await prisma.knowledgeBase.create({
      data: {
        merchantId: merchant.id,
        contentType: body.contentType,
        title: body.title,
        content: body.content,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Best-effort vector sync
    try {
      await batchSyncKnowledgeBase([
        {
          id: entry.id,
          merchantId: merchant.id,
          contentType: entry.contentType,
          title: entry.title,
          content: entry.content,
          metadata: (entry.metadata as Record<string, unknown>) ?? {},
        },
      ]);
    } catch {
      // Pinecone may be unavailable in local/dev
    }

    return reply.status(201).send(entry);
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/merchant/knowledge-base/:id',
    async (request, reply) => {
      const merchant = await resolveMerchant(request.auth);
      if (!merchant) {
        return reply.status(404).send({
          error: { message: 'Merchant not found', statusCode: 404 },
        });
      }

      const entry = await prisma.knowledgeBase.findFirst({
        where: { id: request.params.id, merchantId: merchant.id },
      });
      if (!entry) {
        return reply.status(404).send({
          error: { message: 'Knowledge base entry not found', statusCode: 404 },
        });
      }

      await prisma.knowledgeBase.delete({ where: { id: entry.id } });
      return reply.status(204).send();
    },
  );
};

export default merchantsRoutes;
