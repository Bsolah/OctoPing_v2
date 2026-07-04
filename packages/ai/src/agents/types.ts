import { z } from 'zod';

import type { CustomerContext } from '../rag/context-builder';
import type { RetrievedDocument } from '../rag/retriever';

export const IntentType = {
  PRE_SALE: 'PRE_SALE',
  WISMO: 'WISMO',
  RETURNS: 'RETURNS',
  TECHNICAL: 'TECHNICAL',
  SMALL_TALK: 'SMALL_TALK',
  ESCALATION_REQUEST: 'ESCALATION_REQUEST',
  UNKNOWN: 'UNKNOWN',
} as const;

export type IntentType = (typeof IntentType)[keyof typeof IntentType];

export const SentimentType = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  NEGATIVE: 'negative',
  FRUSTRATED: 'frustrated',
} as const;

export type SentimentType = (typeof SentimentType)[keyof typeof SentimentType];

export const AgentActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()).optional(),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

export const SpecialistOutputSchema = z.object({
  response: z.string(),
  actions: z.array(AgentActionSchema).default([]),
  confidence: z.number().min(0).max(1),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().optional(),
        productId: z.string().optional(),
        contentType: z.string().optional(),
      }),
    )
    .default([]),
});

export type SpecialistOutput = z.infer<typeof SpecialistOutputSchema>;

export const SupervisorDecisionSchema = z.object({
  intent: z.enum([
    'PRE_SALE',
    'WISMO',
    'RETURNS',
    'TECHNICAL',
    'SMALL_TALK',
    'ESCALATION_REQUEST',
    'UNKNOWN',
  ]),
  confidence: z.number().min(0).max(1),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'frustrated']),
  reasoning: z.string(),
  escalateImmediately: z.boolean().default(false),
});

export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
};

export type EscalationPackage = {
  transcriptSummary: string;
  customerProfile: Record<string, unknown>;
  orderHistory: unknown[];
  aiReasoning: string;
  suggestedHumanResponse: string;
  intent?: IntentType;
  sentiment?: SentimentType;
};

export type AgentState = {
  messages: AgentMessage[];
  intent: IntentType;
  confidence: number;
  sentiment: SentimentType;
  customerContext: CustomerContext | null;
  merchantId: string;
  conversationId: string;
  shopName: string;
  shopDomain: string;
  tone: string;
  rules: string[];
  toolsCalled: string[];
  escalationReason?: string;
  escalationPackage?: EscalationPackage;
  response: string;
  actions: AgentAction[];
  sources: SpecialistOutput['sources'];
  documents: RetrievedDocument[];
  nextNode?: string;
  error?: string;
};

export const CONFIDENCE_THRESHOLD = 0.7;

export type AgentNodeName =
  | 'supervisor'
  | 'pre_sale'
  | 'wismo'
  | 'returns'
  | 'technical'
  | 'small_talk'
  | 'escalation'
  | 'response_formatter';
