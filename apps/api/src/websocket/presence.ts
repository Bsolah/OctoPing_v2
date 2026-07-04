import type { AgentPresenceStatus } from '@nova/shared';

import { getRedis } from '@/lib/redis';

const PRESENCE_TTL_SECONDS = 60 * 5;

function presenceKey(merchantId: string): string {
  return `presence:merchant:${merchantId}`;
}

export type AgentPresence = {
  agentId: string;
  status: AgentPresenceStatus;
  lastSeen: string;
};

export async function setAgentPresence(
  merchantId: string,
  agentId: string,
  status: AgentPresenceStatus,
): Promise<void> {
  const redis = getRedis();
  const key = presenceKey(merchantId);
  const payload: AgentPresence = {
    agentId,
    status,
    lastSeen: new Date().toISOString(),
  };
  await redis.hset(key, agentId, JSON.stringify(payload));
  await redis.expire(key, PRESENCE_TTL_SECONDS);
}

export async function getMerchantPresence(
  merchantId: string,
): Promise<AgentPresence[]> {
  const redis = getRedis();
  const all = await redis.hgetall(presenceKey(merchantId));
  return Object.values(all).map((raw) => JSON.parse(raw) as AgentPresence);
}

export async function clearAgentPresence(
  merchantId: string,
  agentId: string,
): Promise<void> {
  await getRedis().hdel(presenceKey(merchantId), agentId);
}
