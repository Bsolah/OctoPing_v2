import { getPreSalePrompt } from '../prompts/pre-sale';
import { retrieveProductContext } from '../rag/retriever';

import { applySpecialistOutput, runSpecialist } from './specialist-runner';
import { createAgentTools } from './tools';
import { CONFIDENCE_THRESHOLD, type AgentState } from './types';

/**
 * Pre-sale specialist: product Q&A, comparisons, sizing, cart suggestions.
 */
export async function preSaleAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const tools = createAgentTools({
    merchantId: state.merchantId,
    conversationId: state.conversationId,
    customerEmail: state.customerContext?.customer.email,
  });

  const latestUser =
    [...state.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const documents = await retrieveProductContext(
    state.merchantId,
    latestUser,
    5,
  );

  const toolResults: string[] = [];
  const toolsCalled: string[] = [];

  try {
    const search = await tools.searchProducts.invoke({
      query: latestUser,
      topK: 5,
    });
    toolsCalled.push('searchProducts');
    toolResults.push(`searchProducts: ${search}`);

    const details = await tools.getProductDetails.invoke({
      query: latestUser,
    });
    toolsCalled.push('getProductDetails');
    toolResults.push(`getProductDetails: ${details}`);
  } catch (error) {
    toolResults.push(
      `tool_error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const output = await runSpecialist({
    state,
    agentName: 'pre_sale',
    promptTemplate: getPreSalePrompt('prompt_v1').template,
    toolNames: [
      'searchProducts',
      'getProductDetails',
      'compareProducts',
      'getReviews',
      'addToCart',
    ],
    toolResults,
    documents,
    extraInstructions:
      'Include product links/urls and prices when available in context. Ask one clarifying question if needed.',
  });

  const partial = applySpecialistOutput(state, output, toolsCalled, documents);

  if (output.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...partial,
      nextNode: 'escalation',
      escalationReason: `Pre-sale confidence ${output.confidence}`,
    };
  }

  return { ...partial, nextNode: 'response_formatter' };
}
