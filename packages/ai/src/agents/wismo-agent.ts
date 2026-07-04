import { getWismoPrompt } from '../prompts/wismo';

import { applySpecialistOutput, runSpecialist } from './specialist-runner';
import { createAgentTools } from './tools';
import { CONFIDENCE_THRESHOLD, type AgentState } from './types';

function buildTimelineDescription(
  orders: AgentState['customerContext'],
): string {
  const order = orders?.orders[0];
  if (!order) {
    return 'No order timeline available.';
  }

  const steps = [
    `Order placed (${order.createdAt ?? 'unknown date'})`,
    order.status ? `Status: ${order.status}` : null,
    order.carrier ? `Carrier: ${order.carrier}` : null,
    order.trackingNumbers?.length
      ? `Tracking: ${order.trackingNumbers.join(', ')}`
      : 'Tracking not yet available',
  ].filter(Boolean);

  return `Visual timeline:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

/**
 * WISMO specialist: tracking, delays, proactive goodwill.
 */
export async function wismoAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const tools = createAgentTools({
    merchantId: state.merchantId,
    conversationId: state.conversationId,
    customerEmail: state.customerContext?.customer.email,
  });

  const order = state.customerContext?.orders[0];
  const toolResults: string[] = [];
  const toolsCalled: string[] = [];

  try {
    const status = await tools.getOrderStatus.invoke({
      orderId: order?.id,
      email: state.customerContext?.customer.email,
    });
    toolsCalled.push('getOrderStatus');
    toolResults.push(`getOrderStatus: ${status}`);

    const trackingNumber = order?.trackingNumbers?.[0];
    if (trackingNumber) {
      const tracking = await tools.getTrackingInfo.invoke({
        trackingNumber,
        carrier: order?.carrier,
      });
      toolsCalled.push('getTrackingInfo');
      toolResults.push(`getTrackingInfo: ${tracking}`);
    }

    const delay = await tools.explainDelay.invoke({
      reasonCode: order?.status?.toLowerCase().includes('delay')
        ? 'carrier_delay'
        : 'unknown',
    });
    toolsCalled.push('explainDelay');
    toolResults.push(`explainDelay: ${delay}`);
  } catch (error) {
    toolResults.push(
      `tool_error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const timeline = buildTimelineDescription(state.customerContext);
  const isDelayed =
    order?.status?.toLowerCase().includes('delay') ||
    order?.status?.toLowerCase().includes('exception');

  const output = await runSpecialist({
    state,
    agentName: 'wismo',
    promptTemplate: getWismoPrompt('prompt_v1').template,
    toolNames: [
      'getOrderStatus',
      'getTrackingInfo',
      'explainDelay',
      'offerCompensation',
    ],
    toolResults: [...toolResults, timeline],
    extraInstructions: isDelayed
      ? 'Delay detected: include a proactive apology and only offer compensation allowed by merchant rules.'
      : 'Explain tracking clearly using the timeline.',
  });

  const partial = applySpecialistOutput(state, output, toolsCalled);

  if (output.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...partial,
      nextNode: 'escalation',
      escalationReason: `WISMO confidence ${output.confidence}`,
    };
  }

  return { ...partial, nextNode: 'response_formatter' };
}
