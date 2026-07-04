import {
  buildCustomerContext,
  processAgentTurn,
  type CustomerContextStore,
} from '@nova/ai';
import type { Merchant } from '@prisma/client';

import { prisma } from '@/lib/prisma';

const store: CustomerContextStore = {
  async getConversation(conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 50 },
      },
    });
    if (!conversation) return null;
    return {
      id: conversation.id,
      merchantId: conversation.merchantId,
      customerEmail: conversation.customerEmail,
      channel: conversation.channel,
      status: conversation.status,
      messages: conversation.messages.map((m) => ({
        role:
          m.senderType === 'customer'
            ? 'customer'
            : m.senderType === 'ai'
              ? 'ai'
              : m.senderType === 'human'
                ? 'assistant'
                : 'system',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  },
  async getCustomerOrders(merchantId, email) {
    const orders = await prisma.order.findMany({
      where: { merchantId, customerEmail: email },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return orders.map((o) => ({
      id: o.id,
      status: o.fulfillmentStatus ?? undefined,
      totalPrice: o.totalPrice?.toString(),
      trackingNumbers: o.trackingNumbers,
      carrier: o.carrier ?? undefined,
      createdAt: o.createdAt.toISOString(),
    }));
  },
  async getPastConversations(merchantId, email, limit = 5) {
    const conversations = await prisma.conversation.findMany({
      where: { merchantId, customerEmail: email },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return conversations.map((c) => ({
      id: c.id,
      status: c.status,
      channel: c.channel,
      createdAt: c.createdAt.toISOString(),
      lastMessage: c.messages[0]?.content,
    }));
  },
};

export async function runConversationAi(options: {
  merchant: Merchant;
  conversationId: string;
  message: string;
}) {
  const customerContext = await buildCustomerContext(
    options.conversationId,
    store,
  );

  const rules = Array.isArray(options.merchant.aiRules)
    ? (options.merchant.aiRules as string[])
    : [];

  return processAgentTurn({
    conversationId: options.conversationId,
    merchantId: options.merchant.id,
    shopName: options.merchant.shopDomain,
    shopDomain: options.merchant.shopDomain,
    message: options.message,
    tone: options.merchant.aiTone,
    rules,
    customerContext,
  });
}
