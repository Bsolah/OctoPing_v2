import Redis from 'ioredis';

import type { AgentState } from './types';
import { IntentType, SentimentType } from './types';

const STATE_PREFIX = 'agent:state:';
const STATE_TTL_SECONDS = 60 * 60 * 24;

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is required for agent state persistence');
    }
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redisClient;
}

export async function connectAgentStateStore(): Promise<void> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
}

export async function disconnectAgentStateStore(): Promise<void> {
  if (redisClient && redisClient.status !== 'end') {
    await redisClient.quit();
    redisClient = null;
  }
}

export function createInitialState(
  partial: Pick<
    AgentState,
    | 'merchantId'
    | 'conversationId'
    | 'shopName'
    | 'shopDomain'
    | 'tone'
    | 'rules'
  > &
    Partial<AgentState>,
): AgentState {
  return {
    messages: partial.messages ?? [],
    intent: partial.intent ?? IntentType.UNKNOWN,
    confidence: partial.confidence ?? 0,
    sentiment: partial.sentiment ?? SentimentType.NEUTRAL,
    customerContext: partial.customerContext ?? null,
    merchantId: partial.merchantId,
    conversationId: partial.conversationId,
    shopName: partial.shopName,
    shopDomain: partial.shopDomain,
    tone: partial.tone,
    rules: partial.rules,
    toolsCalled: partial.toolsCalled ?? [],
    escalationReason: partial.escalationReason,
    escalationPackage: partial.escalationPackage,
    response: partial.response ?? '',
    actions: partial.actions ?? [],
    sources: partial.sources ?? [],
    documents: partial.documents ?? [],
    nextNode: partial.nextNode,
    error: partial.error,
  };
}

export async function loadAgentState(
  conversationId: string,
): Promise<AgentState | null> {
  const raw = await getRedis().get(`${STATE_PREFIX}${conversationId}`);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as AgentState;
}

export async function saveAgentState(state: AgentState): Promise<void> {
  await getRedis().set(
    `${STATE_PREFIX}${state.conversationId}`,
    JSON.stringify(state),
    'EX',
    STATE_TTL_SECONDS,
  );
}
