import { applySpecialistOutput, runSpecialist } from './specialist-runner';
import type { AgentState } from './types';

const SMALL_TALK_PROMPT = `You are Nova Support for [shopName].
Respond warmly to greetings and small talk.
Keep it brief, then invite the customer to share how you can help with orders or products.
Tone: [tone]
Rules:
[rules]`;

export async function smallTalkAgentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const output = await runSpecialist({
    state,
    agentName: 'small_talk',
    promptTemplate: SMALL_TALK_PROMPT,
    toolNames: [],
    extraInstructions: 'Do not invent promotions. Be friendly and concise.',
  });

  return {
    ...applySpecialistOutput(state, output, []),
    nextNode: 'response_formatter',
  };
}
