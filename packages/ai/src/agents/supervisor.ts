import { chat } from '../llm/client';
import { MODELS } from '../llm/models';
import type { ChatMessage } from '../llm/types';

import {
  CONFIDENCE_THRESHOLD,
  IntentType,
  SentimentType,
  SupervisorDecisionSchema,
  type AgentState,
  type SupervisorDecision,
} from './types';

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function latestUserMessage(state: AgentState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i]?.role === 'user') {
      return state.messages[i]!.content;
    }
  }
  return '';
}

/**
 * Supervisor: classify intent + sentiment, choose next specialist node.
 */
export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const userMessage = latestUserMessage(state);
  const history = state.messages
    .slice(-10)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are the Nova Support supervisor. Classify the customer message.

Return ONLY JSON:
{
  "intent": "PRE_SALE" | "WISMO" | "RETURNS" | "TECHNICAL" | "SMALL_TALK" | "ESCALATION_REQUEST" | "UNKNOWN",
  "confidence": 0-1,
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "reasoning": "short reason",
  "escalateImmediately": boolean
}

Routing guide:
- PRE_SALE: products, sizing, recommendations, cart
- WISMO: order status, tracking, delivery delays
- RETURNS: refunds, exchanges, return labels
- TECHNICAL: checkout errors, payment failures, cart bugs
- SMALL_TALK: greetings, thanks
- ESCALATION_REQUEST: customer asks for a human
- UNKNOWN: cannot classify

Set escalateImmediately=true if customer is abusive, legal threat, or explicitly demands a human.`,
    },
    {
      role: 'user',
      content: `History:\n${history || '(none)'}\n\nLatest message:\n${userMessage}`,
    },
  ];

  let decision: SupervisorDecision;
  try {
    const result = await chat(messages, MODELS.fast.id, {
      merchantId: state.merchantId,
    });
    const parsed = SupervisorDecisionSchema.safeParse(
      extractJsonObject(result.content),
    );
    decision = parsed.success
      ? parsed.data
      : {
          intent: IntentType.UNKNOWN,
          confidence: 0.3,
          sentiment: SentimentType.NEUTRAL,
          reasoning: 'Failed to parse supervisor output',
          escalateImmediately: true,
        };
  } catch {
    decision = {
      intent: IntentType.UNKNOWN,
      confidence: 0.2,
      sentiment: SentimentType.NEUTRAL,
      reasoning: 'Supervisor LLM error',
      escalateImmediately: true,
    };
  }

  let nextNode = routeIntent(decision.intent);
  let escalationReason: string | undefined;

  if (decision.escalateImmediately) {
    nextNode = 'escalation';
    escalationReason = decision.reasoning || 'Supervisor requested escalation';
  } else if (decision.sentiment === SentimentType.FRUSTRATED) {
    nextNode = 'escalation';
    escalationReason = 'Customer sentiment is frustrated';
  } else if (decision.confidence < CONFIDENCE_THRESHOLD) {
    nextNode = 'escalation';
    escalationReason = `Low confidence (${decision.confidence.toFixed(2)})`;
  } else if (decision.intent === IntentType.ESCALATION_REQUEST) {
    nextNode = 'escalation';
    escalationReason = 'Customer requested human agent';
  }

  return {
    intent: decision.intent,
    confidence: decision.confidence,
    sentiment: decision.sentiment,
    nextNode,
    escalationReason,
  };
}

export function routeIntent(intent: IntentType): string {
  switch (intent) {
    case IntentType.PRE_SALE:
      return 'pre_sale';
    case IntentType.WISMO:
      return 'wismo';
    case IntentType.RETURNS:
      return 'returns';
    case IntentType.TECHNICAL:
      return 'technical';
    case IntentType.SMALL_TALK:
      return 'small_talk';
    case IntentType.ESCALATION_REQUEST:
    case IntentType.UNKNOWN:
    default:
      return 'escalation';
  }
}
