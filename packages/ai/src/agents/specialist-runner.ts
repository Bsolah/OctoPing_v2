import { chat } from '../llm/client';
import { MODELS } from '../llm/models';
import type { ChatMessage } from '../llm/types';
import { buildSystemPrompt } from '../rag/context-builder';
import type { RetrievedDocument } from '../rag/retriever';

import {
  SpecialistOutputSchema,
  type AgentState,
  type SpecialistOutput,
} from './types';

function sourcesFromDocuments(documents: RetrievedDocument[]) {
  return documents.map((doc) => ({
    title: doc.source.title || doc.title,
    url: doc.source.url,
    productId: doc.source.productId,
    contentType: doc.source.contentType || doc.contentType,
  }));
}

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

export async function runSpecialist(options: {
  state: AgentState;
  agentName: string;
  promptTemplate: string;
  toolNames: string[];
  toolResults?: string[];
  documents?: RetrievedDocument[];
  extraInstructions?: string;
}): Promise<SpecialistOutput> {
  const {
    state,
    agentName,
    promptTemplate,
    toolNames,
    toolResults = [],
    documents = [],
    extraInstructions = '',
  } = options;

  const system = buildSystemPrompt(
    {
      id: state.merchantId,
      shopName: state.shopName,
      shopDomain: state.shopDomain,
      tone: state.tone,
      rules: state.rules,
    },
    state.tone,
    state.rules,
    promptTemplate,
  );

  const history = state.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }) as ChatMessage);

  const contextBlocks = [
    `Agent: ${agentName}`,
    `Available tools: ${toolNames.join(', ')}`,
    documents.length
      ? `RAG sources:\n${documents
          .map(
            (d, i) =>
              `[${i + 1}] ${d.title} (score=${d.score.toFixed(3)}) product_id=${d.source.productId ?? 'n/a'} url=${d.source.url ?? 'n/a'}\n${d.content.slice(0, 500)}`,
          )
          .join('\n\n')}`
      : 'RAG sources: none',
    toolResults.length
      ? `Tool results:\n${toolResults.join('\n')}`
      : 'Tool results: none',
    state.customerContext
      ? `Customer context: ${JSON.stringify({
          email: state.customerContext.customer.email,
          orders: state.customerContext.orders.slice(0, 3),
        })}`
      : 'Customer context: none',
    extraInstructions,
    `Return ONLY valid JSON matching:
{
  "response": string,
  "actions": [{"type": string, "payload"?: object}],
  "confidence": number,
  "sources": [{"title": string, "url"?: string, "productId"?: string, "contentType"?: string}]
}`,
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'system', content: contextBlocks.filter(Boolean).join('\n\n') },
    ...history,
  ];

  try {
    const result = await chat(messages, MODELS.fast.id, {
      merchantId: state.merchantId,
    });

    const parsed = extractJsonObject(result.content);
    const validated = SpecialistOutputSchema.safeParse(parsed);
    if (validated.success) {
      const sources =
        validated.data.sources.length > 0
          ? validated.data.sources
          : sourcesFromDocuments(documents);
      return { ...validated.data, sources };
    }

    return {
      response: result.content,
      actions: [],
      confidence: 0.55,
      sources: sourcesFromDocuments(documents),
    };
  } catch (error) {
    return {
      response:
        'I ran into a problem preparing a full answer. A teammate can help right away.',
      actions: [{ type: 'escalate', payload: { reason: 'specialist_error' } }],
      confidence: 0.2,
      sources: sourcesFromDocuments(documents),
      // attach error via response only; graph handles escalation
    };
  }
}

export function applySpecialistOutput(
  state: AgentState,
  output: SpecialistOutput,
  toolsCalled: string[],
  documents: RetrievedDocument[] = [],
): Partial<AgentState> {
  return {
    response: output.response,
    actions: output.actions,
    sources: output.sources,
    confidence: output.confidence,
    toolsCalled: toolsCalled,
    documents,
  };
}
