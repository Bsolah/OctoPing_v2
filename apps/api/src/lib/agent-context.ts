import type { Agent } from '@prisma/client';

import { planAgentLimit } from '@/lib/billing/plans';
import { prisma } from '@/lib/prisma';
import type { AuthPrincipal } from '@/plugins/auth';
import { resolveMerchant } from '@/lib/merchant-context';

/**
 * Resolve the current agent for the authenticated principal.
 * Creates a lightweight agent profile on first access for dashboard users.
 */
export async function resolveAgent(auth: AuthPrincipal): Promise<Agent | null> {
  const merchant = await resolveMerchant(auth);
  if (!merchant) return null;

  if (auth.agentId) {
    const byId = await prisma.agent.findFirst({
      where: { id: auth.agentId, merchantId: merchant.id },
    });
    if (byId) return byId;
  }

  const email = auth.userId?.includes('@')
    ? auth.userId
    : `${auth.userId ?? 'agent'}@${merchant.shopDomain}`;

  const existing = await prisma.agent.findUnique({
    where: {
      merchantId_email: {
        merchantId: merchant.id,
        email,
      },
    },
  });
  if (existing) return existing;

  const agentCount = await prisma.agent.count({
    where: { merchantId: merchant.id },
  });
  const limit = planAgentLimit(merchant.planTier);
  if (limit != null && agentCount >= limit) {
    const error = new Error(
      `Agent seat limit reached for ${merchant.planTier} plan (${limit})`,
    );
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }

  // Auto-provision agent seat for authenticated merchant users (not viewers by default)
  return prisma.agent.create({
    data: {
      merchantId: merchant.id,
      email,
      name: auth.userId ?? 'Agent',
      role: auth.type === 'api_key' ? 'admin' : 'agent',
      isOnline: true,
      workingHours: {
        timezone: 'UTC',
        days: {
          mon: { start: '00:00', end: '23:59' },
          tue: { start: '00:00', end: '23:59' },
          wed: { start: '00:00', end: '23:59' },
          thu: { start: '00:00', end: '23:59' },
          fri: { start: '00:00', end: '23:59' },
          sat: { start: '00:00', end: '23:59' },
          sun: { start: '00:00', end: '23:59' },
        },
      },
    },
  });
}

export function assertAgentCanHandle(role: string): void {
  if (role === 'viewer') {
    const error = new Error('Insufficient permissions');
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}
