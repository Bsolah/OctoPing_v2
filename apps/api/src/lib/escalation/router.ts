import { Prisma } from '@prisma/client';

import { getLogger } from '@/lib/observability';
import { getRedis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { getMerchantPresence, type AgentPresence } from '@/websocket/presence';
import { broadcast, merchantRoom } from '@/websocket/rooms';

import { trackEvent } from '@/lib/analytics/events';

import {
  buildEscalationContext,
  type EscalationContextPackage,
} from './context-builder';

const RR_KEY = (merchantId: string) => `escalation:rr:${merchantId}`;
const DEFAULT_SLA_MINUTES = 15;

type WorkingHours = {
  timezone?: string;
  days?: Record<string, { start: string; end: string } | null>;
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isWithinWorkingHours(
  workingHours: WorkingHours | null | undefined,
  now = new Date(),
): boolean {
  if (!workingHours?.days) {
    return true; // no schedule configured = always available
  }

  const day = DAY_KEYS[now.getUTCDay()];
  const window = workingHours.days[day ?? 'mon'];
  if (!window) {
    return false;
  }

  const start = parseTimeToMinutes(window.start);
  const end = parseTimeToMinutes(window.end);
  if (start == null || end == null) {
    return true;
  }

  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= start && minutes <= end;
}

function canHandleEscalations(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'agent';
}

async function pickAgentRoundRobin(
  merchantId: string,
  available: Array<{ id: string }>,
): Promise<string | null> {
  if (available.length === 0) return null;

  const redis = getRedis();
  const index = await redis.incr(RR_KEY(merchantId));
  const agent = available[(index - 1) % available.length];
  return agent?.id ?? null;
}

function onlineAgents(
  agents: Array<{ id: string; role: string; workingHours: unknown }>,
  presence: AgentPresence[],
): Array<{ id: string }> {
  const presenceMap = new Map(presence.map((p) => [p.agentId, p]));

  return agents
    .filter((agent) => canHandleEscalations(agent.role))
    .filter((agent) => {
      const status = presenceMap.get(agent.id)?.status;
      return status === 'online';
    })
    .filter((agent) =>
      isWithinWorkingHours(agent.workingHours as WorkingHours | null),
    )
    .map((agent) => ({ id: agent.id }));
}

export type EscalationResult = {
  conversationId: string;
  assignedAgentId: string | null;
  queued: boolean;
  priorityScore: number;
  priorityLabel: EscalationContextPackage['priorityLabel'];
  context: EscalationContextPackage;
  slaDueAt: string | null;
};

/**
 * Build context, assign an available agent (or queue), and notify the merchant room.
 */
export async function escalateConversation(
  conversationId: string,
  options: {
    reason?: string;
    sentiment?: string;
    toolsUsed?: string[];
    actorId?: string;
  } = {},
): Promise<EscalationResult> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });

  const context = await buildEscalationContext(conversationId, {
    sentiment: options.sentiment,
    toolsUsed: options.toolsUsed,
  });

  const [agents, presence] = await Promise.all([
    prisma.agent.findMany({
      where: { merchantId: conversation.merchantId },
      select: { id: true, role: true, workingHours: true },
    }),
    getMerchantPresence(conversation.merchantId),
  ]);

  const available = onlineAgents(agents, presence);
  const assignedAgentId = await pickAgentRoundRobin(
    conversation.merchantId,
    available,
  );

  const now = new Date();
  const slaDueAt = assignedAgentId
    ? null
    : new Date(now.getTime() + DEFAULT_SLA_MINUTES * 60_000);

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'escalated',
      aiPaused: true,
      escalatedTo: assignedAgentId ?? options.actorId ?? 'queue',
      assignedAgentId,
      priority: context.priorityScore,
      escalationContext: context as unknown as Prisma.InputJsonValue,
      queuedAt: assignedAgentId ? null : now,
      slaDueAt,
    },
  });

  trackEvent(conversation.merchantId, 'human_escalation', {
    conversationId,
    reason: options.reason,
    assignedAgentId,
    queued: !assignedAgentId,
    priorityScore: context.priorityScore,
    assembledInMs: context.assembledInMs,
  });

  broadcast(merchantRoom(conversation.merchantId), {
    type: 'chat_message',
    conversationId,
    messageId: conversationId,
    senderType: 'system',
    content: assignedAgentId
      ? 'Conversation assigned to an agent'
      : 'Conversation queued for next available agent',
    createdAt: new Date().toISOString(),
  });

  // Dedicated queue event for inbox clients
  broadcast(merchantRoom(conversation.merchantId), {
    type: 'presence',
    merchantId: conversation.merchantId,
    agents: presence,
  });

  getLogger().info(
    {
      conversationId,
      assignedAgentId,
      queued: !assignedAgentId,
      priority: context.priorityScore,
      assembledInMs: context.assembledInMs,
    },
    'Conversation escalated',
  );

  return {
    conversationId: updated.id,
    assignedAgentId,
    queued: !assignedAgentId,
    priorityScore: context.priorityScore,
    priorityLabel: context.priorityLabel,
    context,
    slaDueAt: slaDueAt?.toISOString() ?? null,
  };
}

/**
 * Assign the next queued conversation to an agent who just came online.
 */
export async function claimNextFromQueue(
  merchantId: string,
  agentId: string,
): Promise<string | null> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, merchantId },
  });
  if (!agent || !canHandleEscalations(agent.role)) {
    return null;
  }

  const queued = await prisma.conversation.findFirst({
    where: {
      merchantId,
      status: 'escalated',
      assignedAgentId: null,
    },
    orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
  });

  if (!queued) return null;

  await prisma.conversation.update({
    where: { id: queued.id },
    data: {
      assignedAgentId: agentId,
      escalatedTo: agentId,
      queuedAt: null,
      slaDueAt: null,
    },
  });

  return queued.id;
}
