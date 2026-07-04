import type { Merchant } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { AuthPrincipal } from '@/plugins/auth';

export async function resolveMerchant(
  auth: AuthPrincipal,
): Promise<Merchant | null> {
  const byId = await prisma.merchant.findUnique({
    where: { id: auth.merchantId },
  });
  if (byId) {
    return byId;
  }

  const domain = auth.shopDomain ?? auth.merchantId;
  return prisma.merchant.findUnique({
    where: { shopDomain: domain },
  });
}

export function assertMerchantAccess(
  resourceMerchantId: string,
  authMerchantId: string,
): void {
  if (resourceMerchantId !== authMerchantId) {
    const error = new Error('Forbidden');
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}
