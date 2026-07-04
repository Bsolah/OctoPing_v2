import { applySpecialistOutput, runSpecialist } from './specialist-runner';
import { createAgentTools } from './tools';
import { CONFIDENCE_THRESHOLD, type AgentState } from './types';

const TECHNICAL_PROMPT = `You are the Nova Support technical agent for [shopName].

Handle checkout, payment, and cart issues.
- Diagnose common checkout errors.
- Check payment status when relevant.
- Offer cart reset when the cart appears corrupted.
- Never request full card numbers or CVV.

Tone: [tone]
Rules:
[rules]`;

/**
 * Technical specialist: checkout/payment/cart recovery.
 */
export async function technicalAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const tools = createAgentTools({
    merchantId: state.merchantId,
    conversationId: state.conversationId,
    customerEmail: state.customerContext?.customer.email,
  });

  const latestUser =
    [...state.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const toolResults: string[] = [];
  const toolsCalled: string[] = [];

  try {
    const diagnosis = await tools.diagnoseCheckoutError.invoke({
      description: latestUser,
    });
    toolsCalled.push('diagnoseCheckoutError');
    toolResults.push(`diagnoseCheckoutError: ${diagnosis}`);

    const payment = await tools.checkPaymentStatus.invoke({});
    toolsCalled.push('checkPaymentStatus');
    toolResults.push(`checkPaymentStatus: ${payment}`);
  } catch (error) {
    toolResults.push(
      `tool_error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const output = await runSpecialist({
    state,
    agentName: 'technical',
    promptTemplate: TECHNICAL_PROMPT,
    toolNames: ['diagnoseCheckoutError', 'checkPaymentStatus', 'resetCart'],
    toolResults,
    extraInstructions:
      'Provide step-by-step recovery. Suggest resetCart action only if other steps fail.',
  });

  const partial = applySpecialistOutput(state, output, toolsCalled);

  if (output.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...partial,
      nextNode: 'escalation',
      escalationReason: `Technical confidence ${output.confidence}`,
    };
  }

  return { ...partial, nextNode: 'response_formatter' };
}
