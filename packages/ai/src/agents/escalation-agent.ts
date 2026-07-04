import { chat } from '../llm/client';
import { MODELS } from '../llm/models';
import type { ChatMessage } from '../llm/types';

import type { AgentState, EscalationPackage } from './types';

export type EscalationNotifier = (payload: {
  merchantId: string;
  conversationId: string;
  escalationPackage: EscalationPackage;
}) => Promise<void>;

let notifier: EscalationNotifier | null = null;

/**
 * Register a host callback (e.g. Redis pub/sub or WebSocket broadcast).
 */
export function setEscalationNotifier(fn: EscalationNotifier): void {
  notifier = fn;
}

/**
 * Escalation node: build human handoff package and notify agents.
 */
export async function escalationAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const transcript = state.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Create a concise escalation package for a human support agent.
Return ONLY JSON:
{
  "transcriptSummary": string,
  "suggestedHumanResponse": string,
  "aiReasoning": string
}`,
    },
    {
      role: 'user',
      content: `Intent: ${state.intent}
Sentiment: ${state.sentiment}
Confidence: ${state.confidence}
Escalation reason: ${state.escalationReason ?? 'unspecified'}
Customer: ${JSON.stringify(state.customerContext?.customer ?? {})}
Orders: ${JSON.stringify(state.customerContext?.orders?.slice(0, 5) ?? [])}
Transcript:
${transcript}`,
    },
  ];

  let transcriptSummary = 'Customer needs human assistance.';
  let suggestedHumanResponse =
    'Hi — thanks for your patience. I can help take it from here.';
  let aiReasoning = state.escalationReason ?? 'Routed to escalation';

  try {
    const result = await chat(messages, MODELS.fast.id, {
      merchantId: state.merchantId,
    });
    const start = result.content.indexOf('{');
    const end = result.content.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(result.content.slice(start, end + 1)) as {
        transcriptSummary?: string;
        suggestedHumanResponse?: string;
        aiReasoning?: string;
      };
      transcriptSummary = parsed.transcriptSummary ?? transcriptSummary;
      suggestedHumanResponse =
        parsed.suggestedHumanResponse ?? suggestedHumanResponse;
      aiReasoning = parsed.aiReasoning ?? aiReasoning;
    }
  } catch {
    // keep defaults
  }

  const escalationPackage: EscalationPackage = {
    transcriptSummary,
    customerProfile: {
      email: state.customerContext?.customer.email,
      merchantId: state.merchantId,
      conversationId: state.conversationId,
    },
    orderHistory: state.customerContext?.orders ?? [],
    aiReasoning,
    suggestedHumanResponse,
    intent: state.intent,
    sentiment: state.sentiment,
  };

  const response = `I'm connecting you with a human teammate who can help further. They'll have the full context of our conversation.\n\nMeanwhile: ${suggestedHumanResponse}`;

  if (notifier) {
    try {
      await notifier({
        merchantId: state.merchantId,
        conversationId: state.conversationId,
        escalationPackage,
      });
    } catch {
      // notification failures should not block customer response
    }
  }

  return {
    response,
    escalationPackage,
    actions: [
      {
        type: 'update_conversation_status',
        payload: { status: 'ESCALATED' },
      },
      {
        type: 'notify_human_agents',
        payload: {
          channel: `merchant:${state.merchantId}:agents`,
          conversationId: state.conversationId,
        },
      },
    ],
    sources: [],
    confidence: 1,
    nextNode: 'response_formatter',
  };
}
