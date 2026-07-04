import { getLogger } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { encryptPII } from '@/lib/security';

export async function handleAppUninstalled(shopDomain: string): Promise<void> {
  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain },
  });

  if (!merchant) {
    return;
  }

  await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      isActive: false,
      accessToken: encryptPII('revoked'),
    },
  });

  getLogger().info({ shopDomain, merchantId: merchant.id }, 'App uninstalled');
}
