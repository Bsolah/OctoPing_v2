import { createHash } from 'crypto';

import { Prisma } from '@prisma/client';

import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { maskEmail } from '@/lib/security';

const ANON_DOMAIN = 'anonymized.invalid';

function anonymizedEmail(customerEmail: string): string {
  const digest = createHash('sha256')
    .update(customerEmail.toLowerCase().trim())
    .digest('hex')
    .slice(0, 16);
  return `deleted-${digest}@${ANON_DOMAIN}`;
}

/**
 * GDPR data subject access request — export all records for an email.
 */
export async function exportCustomerData(
  customerEmail: string,
): Promise<Record<string, unknown>> {
  const email = customerEmail.toLowerCase().trim();

  const [conversations, orders, agents] = await Promise.all([
    prisma.conversation.findMany({
      where: { customerEmail: email },
      include: {
        messages: true,
        events: true,
      },
    }),
    prisma.order.findMany({
      where: { customerEmail: email },
    }),
    prisma.agent.findMany({
      where: { email },
    }),
  ]);

  getLogger().info(
    { email: maskEmail(email), conversations: conversations.length },
    'GDPR export completed',
  );

  return {
    exportedAt: new Date().toISOString(),
    customerEmail: email,
    conversations,
    orders,
    agents,
  };
}

/**
 * GDPR right to be forgotten — anonymize PII across all tables.
 * Conversation messages are retained for operational integrity but stripped of PII.
 */
export async function deleteCustomerData(customerEmail: string): Promise<void> {
  const email = customerEmail.toLowerCase().trim();
  const anonEmail = anonymizedEmail(email);

  await prisma.$transaction(async (tx) => {
    const conversations = await tx.conversation.findMany({
      where: { customerEmail: email },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);

    await tx.conversation.updateMany({
      where: { customerEmail: email },
      data: {
        customerEmail: anonEmail,
        customerShopifyId: null,
        escalatedTo: null,
      },
    });

    if (conversationIds.length > 0) {
      await tx.message.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: {
          content: '[redacted]',
          senderId: null,
          metadata: Prisma.JsonNull,
        },
      });

      await tx.event.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: {
          properties: { anonymized: true },
        },
      });
    }

    await tx.order.updateMany({
      where: { customerEmail: email },
      data: {
        customerEmail: anonEmail,
        trackingNumbers: [],
      },
    });

    await tx.agent.updateMany({
      where: { email },
      data: {
        email: anonEmail,
        name: 'Deleted User',
        avatar: null,
        workingHours: Prisma.JsonNull,
        isOnline: false,
      },
    });
  });

  getLogger().info(
    { email: maskEmail(email) },
    'GDPR delete/anonymize completed',
  );
}
