import { chat } from '@nova/ai';
import { MODELS } from '@nova/ai';

import { prisma } from '@/lib/prisma';

export type EscalationContextPackage = {
  conversationSummary: string;
  customerProfile: {
    email: string | null;
    tags: string[];
    orderCount: number;
    ltv: number;
  };
  orderHistory: Array<{
    id: string;
    shopifyOrderId: string;
    status: string | null;
    totalPrice: string | null;
    trackingNumbers: string[];
    trackingStatus: string | null;
    carrier: string | null;
    createdAt: string;
  }>;
  aiReasoningChain: Array<{
    messageId: string;
    intent: string | null;
    confidence: number | null;
    toolsUsed: string[];
    excerpt: string;
  }>;
  suggestedHumanResponse: string;
  priorityScore: number;
  priorityLabel: 'low' | 'medium' | 'high' | 'urgent';
  assembledInMs: number;
};

function extractJson(text: string): Record<string, string> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, string>;
  } catch {
    return null;
  }
}

function priorityLabel(
  score: number,
): EscalationContextPackage['priorityLabel'] {
  if (score >= 80) return 'urgent';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

/**
 * Assemble a full escalation context package in <1s (target).
 */
export async function buildEscalationContext(
  conversationId: string,
  options: {
    sentiment?: string;
    toolsUsed?: string[];
  } = {},
): Promise<EscalationContextPackage> {
  const started = Date.now();

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 40 },
    },
  });

  const email = conversation.customerEmail;

  const [orders, events] = await Promise.all([
    email
      ? prisma.order.findMany({
          where: {
            merchantId: conversation.merchantId,
            customerEmail: email,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : Promise.resolve([]),
    prisma.event.findMany({
      where: {
        conversationId,
        eventType: { in: ['ai.feedback', 'agent.note', 'checkout.abandoned'] },
      },
      take: 20,
    }),
  ]);

  const ltv = orders.reduce(
    (sum, order) => sum + Number(order.totalPrice ?? 0),
    0,
  );
  const tags = events
    .map((event) => {
      const props = event.properties as Record<string, unknown> | null;
      return typeof props?.tag === 'string' ? props.tag : null;
    })
    .filter((tag): tag is string => Boolean(tag));

  const transcript = conversation.messages
    .map((m) => `${m.senderType}: ${m.content}`)
    .join('\n');

  const aiReasoningChain = conversation.messages
    .filter((m) => m.senderType === 'ai')
    .map((m) => {
      const meta = (m.metadata ?? {}) as {
        actions?: Array<{ type?: string }>;
        toolsUsed?: string[];
      };
      const toolsUsed =
        meta.toolsUsed ??
        meta.actions?.map((a) => a.type).filter(Boolean) ??
        options.toolsUsed ??
        [];

      return {
        messageId: m.id,
        intent: m.aiIntent,
        confidence: m.aiConfidence,
        toolsUsed: toolsUsed as string[],
        excerpt: m.content.slice(0, 160),
      };
    });

  let conversationSummary =
    'Customer needs human assistance with an ongoing support issue.';
  let suggestedHumanResponse =
    'Thanks for your patience — I have the full context and can help from here.';

  try {
    const result = await chat(
      [
        {
          role: 'system',
          content: `Create a 3-sentence conversation summary and one suggested human reply.
Return ONLY JSON: {"conversationSummary":"...","suggestedHumanResponse":"..."}`,
        },
        {
          role: 'user',
          content: `Transcript:\n${transcript.slice(-4000)}\n\nOrders: ${orders.length}, LTV: ${ltv}`,
        },
      ],
      MODELS.fast.id,
      { merchantId: conversation.merchantId },
    );

    const parsed = extractJson(result.content);
    if (parsed?.conversationSummary) {
      conversationSummary = parsed.conversationSummary;
    }
    if (parsed?.suggestedHumanResponse) {
      suggestedHumanResponse = parsed.suggestedHumanResponse;
    }
  } catch {
    // keep defaults for speed/reliability
  }

  // Priority: VIP + high order value + frustrated
  let priorityScore = 20;
  if (ltv >= 500) priorityScore += 30;
  else if (ltv >= 150) priorityScore += 15;
  if (orders.length >= 5) priorityScore += 10; // VIP-ish repeat buyer
  if (options.sentiment === 'frustrated') priorityScore += 35;
  if (
    conversation.sentimentScore != null &&
    conversation.sentimentScore < 0.3
  ) {
    priorityScore += 15;
  }
  if (conversation.channel === 'email') priorityScore += 5;
  priorityScore = Math.min(100, priorityScore);

  return {
    conversationSummary,
    customerProfile: {
      email: email ?? null,
      tags: [...new Set(tags)],
      orderCount: orders.length,
      ltv,
    },
    orderHistory: orders.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopifyOrderId.toString(),
      status: order.fulfillmentStatus,
      totalPrice: order.totalPrice?.toString() ?? null,
      trackingNumbers: order.trackingNumbers,
      trackingStatus: order.trackingStatus,
      carrier: order.carrier,
      createdAt: order.createdAt.toISOString(),
    })),
    aiReasoningChain,
    suggestedHumanResponse,
    priorityScore,
    priorityLabel: priorityLabel(priorityScore),
    assembledInMs: Date.now() - started,
  };
}
