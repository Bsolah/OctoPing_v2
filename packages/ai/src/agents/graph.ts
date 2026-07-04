import type { CustomerContext } from '../rag/context-builder';

import { escalationAgentNode } from './escalation-agent';
import { preSaleAgentNode } from './pre-sale-agent';
import { responseFormatterNode } from './response-formatter';
import { returnsAgentNode } from './returns-agent';
import { smallTalkAgentNode } from './small-talk-agent';
import {
  connectAgentStateStore,
  createInitialState,
  loadAgentState,
  saveAgentState,
} from './state-store';
import { supervisorNode } from './supervisor';
import { technicalAgentNode } from './technical-agent';
import { IntentType, type AgentState } from './types';
import { wismoAgentNode } from './wismo-agent';

type NodeFn = (state: AgentState) => Promise<Partial<AgentState>>;

/**
 * LangGraph-style node registry.
 * Topology:
 *   START → supervisor → (pre_sale|wismo|returns|technical|small_talk|escalation)
 *         → response_formatter → END
 * Specialists may loop to escalation when confidence < 0.7.
 */
const NODES: Record<string, NodeFn> = {
  supervisor: supervisorNode,
  pre_sale: preSaleAgentNode,
  wismo: wismoAgentNode,
  returns: returnsAgentNode,
  technical: technicalAgentNode,
  small_talk: smallTalkAgentNode,
  escalation: escalationAgentNode,
  response_formatter: responseFormatterNode,
};

function mergeState(
  state: AgentState,
  update: Partial<AgentState>,
): AgentState {
  return {
    ...state,
    ...update,
    messages: update.messages
      ? [...state.messages, ...update.messages]
      : state.messages,
    toolsCalled: update.toolsCalled
      ? [...state.toolsCalled, ...update.toolsCalled]
      : state.toolsCalled,
  };
}

async function runNodeSafe(
  name: string,
  state: AgentState,
): Promise<AgentState> {
  try {
    const node = NODES[name];
    if (!node) {
      return {
        ...state,
        nextNode: 'escalation',
        escalationReason: `Unknown node: ${name}`,
      };
    }
    const update = await node(state);
    return mergeState(state, update);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return mergeState(state, {
      error: `${name}: ${message}`,
      escalationReason: `Agent error in ${name}`,
      response:
        'Something went wrong on my side. I am connecting you with a human teammate.',
      actions: [
        {
          type: 'update_conversation_status',
          payload: { status: 'ESCALATED' },
        },
      ],
      confidence: 0,
      nextNode: name === 'escalation' ? 'response_formatter' : 'escalation',
    });
  }
}

/**
 * Execute the multi-agent state machine for a single turn.
 */
export async function runAgentGraph(state: AgentState): Promise<AgentState> {
  let current = await runNodeSafe('supervisor', state);
  let node = current.nextNode ?? 'escalation';
  const visited = new Set<string>(['supervisor']);

  if (node !== 'response_formatter') {
    visited.add(node);
    current = await runNodeSafe(node, current);
    node = current.nextNode ?? 'response_formatter';
  }

  if (node === 'escalation' && !visited.has('escalation')) {
    visited.add('escalation');
    current = await runNodeSafe('escalation', current);
  }

  current = await runNodeSafe('response_formatter', current);
  return { ...current, nextNode: undefined };
}

/**
 * Compiled graph facade (LangGraph-compatible invoke API).
 * In-memory checkpointing is represented by thread-scoped Redis state
 * in `processAgentTurn` (conversation continuity across messages).
 */
export function getAgentGraph() {
  return {
    async invoke(
      state: AgentState,
      _config?: { configurable?: { thread_id?: string } },
    ): Promise<AgentState> {
      return runAgentGraph(state);
    },
  };
}

export type ProcessAgentTurnInput = {
  conversationId: string;
  merchantId: string;
  shopName: string;
  shopDomain: string;
  message: string;
  tone?: string;
  rules?: string[];
  customerContext?: CustomerContext | null;
};

/**
 * Process one customer message through the multi-agent graph.
 * Loads/saves AgentState in Redis for conversation continuity.
 */
export async function processAgentTurn(
  input: ProcessAgentTurnInput,
): Promise<AgentState> {
  await connectAgentStateStore();

  const existing = await loadAgentState(input.conversationId);
  const priorMessages = existing?.messages ?? [];

  const initial = createInitialState({
    ...(existing ?? {}),
    merchantId: input.merchantId,
    conversationId: input.conversationId,
    shopName: input.shopName,
    shopDomain: input.shopDomain,
    tone: input.tone ?? existing?.tone ?? 'friendly_professional',
    rules: input.rules ?? existing?.rules ?? [],
    customerContext: input.customerContext ?? existing?.customerContext ?? null,
    messages: [...priorMessages, { role: 'user', content: input.message }],
    response: '',
    actions: [],
    sources: [],
    documents: [],
    toolsCalled: [],
    escalationReason: undefined,
    escalationPackage: undefined,
    error: undefined,
    nextNode: undefined,
  });

  try {
    const result = await runAgentGraph(initial);
    await saveAgentState(result);
    return result;
  } catch (error) {
    const fallback = createInitialState({
      ...initial,
      response:
        'I apologize — I hit an unexpected error. A human agent will follow up shortly.',
      actions: [
        {
          type: 'update_conversation_status',
          payload: { status: 'ESCALATED' },
        },
      ],
      escalationReason:
        error instanceof Error ? error.message : 'graph_invoke_failed',
      confidence: 0,
      intent: IntentType.UNKNOWN,
      messages: [
        ...initial.messages,
        {
          role: 'assistant',
          content:
            'I apologize — I hit an unexpected error. A human agent will follow up shortly.',
        },
      ],
    });
    await saveAgentState(fallback);
    return fallback;
  }
}
