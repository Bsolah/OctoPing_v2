import { getSystemPrompt } from '../prompts/system';
import { retrievePolicyContext } from '../rag/retriever';

import { applySpecialistOutput, runSpecialist } from './specialist-runner';
import { createAgentTools } from './tools';
import { CONFIDENCE_THRESHOLD, type AgentState } from './types';

const RETURNS_PROMPT = `You are the Nova Support returns agent for [shopName].

Help with refunds, exchanges, and return labels.
- Validate the return window against order date when order context exists.
- Guide the customer step-by-step.
- Use policy context only; never invent return windows.
- Tools: checkReturnPolicy, initiateReturn, generateLabel, processExchange.

Tone: [tone]
Rules:
[rules]`;

function daysSince(dateIso?: string): number | null {
  if (!dateIso) return null;
  const then = new Date(dateIso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

/**
 * Returns specialist: policy checks, RMA, labels, exchanges.
 */
export async function returnsAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const tools = createAgentTools({
    merchantId: state.merchantId,
    conversationId: state.conversationId,
    customerEmail: state.customerContext?.customer.email,
  });

  const order = state.customerContext?.orders[0];
  const ageDays = daysSince(order?.createdAt);
  const toolResults: string[] = [];
  const toolsCalled: string[] = [];

  const documents = await retrievePolicyContext(
    state.merchantId,
    'return refund exchange policy',
    3,
  );

  try {
    const policy = await tools.checkReturnPolicy.invoke({
      query: 'return window refund exchange',
    });
    toolsCalled.push('checkReturnPolicy');
    toolResults.push(`checkReturnPolicy: ${policy}`);
  } catch (error) {
    toolResults.push(
      `tool_error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (order) {
    toolResults.push(
      `order_window_check: orderId=${order.id} createdAt=${order.createdAt ?? 'unknown'} ageDays=${ageDays ?? 'unknown'}`,
    );
  }

  const output = await runSpecialist({
    state,
    agentName: 'returns',
    promptTemplate: RETURNS_PROMPT || getSystemPrompt().template,
    toolNames: [
      'checkReturnPolicy',
      'initiateReturn',
      'generateLabel',
      'processExchange',
    ],
    toolResults,
    documents,
    extraInstructions:
      'If outside return window, explain clearly and offer escalation. Otherwise outline steps and propose initiateReturn/generateLabel actions.',
  });

  const partial = applySpecialistOutput(state, output, toolsCalled, documents);

  if (output.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...partial,
      nextNode: 'escalation',
      escalationReason: `Returns confidence ${output.confidence}`,
    };
  }

  return { ...partial, nextNode: 'response_formatter' };
}
