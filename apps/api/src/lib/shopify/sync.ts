import { randomUUID } from 'crypto';

import { getLogger } from '@/lib/observability';
import { batchSyncKnowledgeBase } from '@/lib/pinecone';
import { prisma } from '@/lib/prisma';

import {
  getOrders,
  getProducts,
  getShopPolicies,
  gidToNumericId,
} from './graphql';

/**
 * Fetch all products and upsert product knowledge into Pinecone.
 */
export async function syncProducts(merchantId: string): Promise<number> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const products = await getProducts(merchant.shopDomain);
  const log = getLogger();

  const entries = products.map((product) => ({
    id: `product-${merchantId}-${gidToNumericId(product.id)}`,

    merchantId,
    contentType: 'product',
    title: product.title,
    content: [
      product.title,
      product.description,
      product.vendor ? `Vendor: ${product.vendor}` : '',
      product.productType ? `Type: ${product.productType}` : '',
      product.tags?.length ? `Tags: ${product.tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    metadata: {
      shopifyProductId: product.id,
      handle: product.handle,
      status: product.status,
    },
  }));

  for (const entry of entries) {
    await prisma.knowledgeBase.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        merchantId,
        contentType: entry.contentType,
        title: entry.title,
        content: entry.content,
        metadata: entry.metadata,
      },
      update: {
        title: entry.title,
        content: entry.content,
        metadata: entry.metadata,
      },
    });
  }

  const result = await batchSyncKnowledgeBase(entries);
  log.info(
    { merchantId, products: products.length, ...result },
    'Product sync completed',
  );

  return products.length;
}

/**
 * Fetch recent orders and upsert into the orders table.
 */
export async function syncOrders(merchantId: string): Promise<number> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const orders = await getOrders(merchant.shopDomain);
  let count = 0;

  for (const order of orders) {
    const shopifyOrderId = gidToNumericId(order.id);
    const trackingNumbers =
      order.fulfillments?.flatMap((f) =>
        f.trackingInfo.map((t) => t.number).filter(Boolean),
      ) ?? [];
    const carrier = order.fulfillments?.[0]?.trackingInfo?.[0]?.company ?? null;

    await prisma.order.upsert({
      where: { shopifyOrderId },
      create: {
        merchantId,
        shopifyOrderId,
        customerEmail: order.email ?? null,
        totalPrice: order.totalPriceSet?.shopMoney.amount ?? null,
        fulfillmentStatus: order.displayFulfillmentStatus ?? null,
        trackingNumbers: trackingNumbers as string[],
        carrier,
        createdAt: new Date(order.createdAt),
      },
      update: {
        customerEmail: order.email ?? null,
        totalPrice: order.totalPriceSet?.shopMoney.amount ?? null,
        fulfillmentStatus: order.displayFulfillmentStatus ?? null,
        trackingNumbers: trackingNumbers as string[],
        carrier,
      },
    });
    count += 1;
  }

  getLogger().info({ merchantId, orders: count }, 'Order sync completed');
  return count;
}

/**
 * Fetch shop policies and upsert into knowledge base + Pinecone.
 */
export async function syncPolicies(merchantId: string): Promise<number> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const policies = await getShopPolicies(merchant.shopDomain);
  const entries = policies.map((policy) => ({
    id: `policy-${merchantId}-${policy.type.toLowerCase()}`,
    merchantId,
    contentType: 'policy',
    title: policy.title || policy.type,
    content: policy.body || '',
    metadata: {
      policyType: policy.type,
      url: policy.url,
    },
  }));

  for (const entry of entries) {
    await prisma.knowledgeBase.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        merchantId,
        contentType: entry.contentType,
        title: entry.title,
        content: entry.content,
        metadata: entry.metadata,
      },
      update: {
        title: entry.title,
        content: entry.content,
        metadata: entry.metadata,
      },
    });
  }

  const result = await batchSyncKnowledgeBase(entries);
  getLogger().info(
    { merchantId, policies: policies.length, ...result },
    'Policy sync completed',
  );

  return policies.length;
}

/**
 * Upsert a single order payload from a webhook.
 */
export async function upsertOrderFromWebhook(
  merchantId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; customerEmail: string | null; created: boolean }> {
  const shopifyOrderId = BigInt(String(payload.id));
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof (payload.customer as { email?: string } | undefined)?.email ===
          'string'
        ? (payload.customer as { email: string }).email
        : null;

  const totalPrice =
    typeof payload.total_price === 'string' ||
    typeof payload.total_price === 'number'
      ? String(payload.total_price)
      : null;

  const fulfillmentStatus =
    typeof payload.fulfillment_status === 'string'
      ? payload.fulfillment_status
      : null;

  const fulfillments = Array.isArray(payload.fulfillments)
    ? payload.fulfillments
    : [];

  const trackingNumbers: string[] = [];
  let carrier: string | null = null;

  for (const fulfillment of fulfillments) {
    if (!fulfillment || typeof fulfillment !== 'object') continue;
    const f = fulfillment as Record<string, unknown>;
    if (Array.isArray(f.tracking_numbers)) {
      for (const n of f.tracking_numbers) {
        if (typeof n === 'string') trackingNumbers.push(n);
      }
    }
    if (!carrier && typeof f.tracking_company === 'string') {
      carrier = f.tracking_company;
    }
  }

  const productIds: string[] = [];
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue;
    const line = item as { product_id?: unknown; variant_id?: unknown };
    if (line.product_id != null) productIds.push(String(line.product_id));
  }

  const existing = await prisma.order.findUnique({
    where: { shopifyOrderId },
    select: { id: true },
  });

  const order = await prisma.order.upsert({
    where: { shopifyOrderId },
    create: {
      id: randomUUID(),
      merchantId,
      shopifyOrderId,
      customerEmail: email,
      totalPrice,
      productIds,
      fulfillmentStatus,
      trackingNumbers,
      carrier,
    },
    update: {
      customerEmail: email,
      totalPrice,
      productIds,
      fulfillmentStatus,
      trackingNumbers,
      carrier,
    },
  });

  return {
    id: order.id,
    customerEmail: email,
    created: !existing,
  };
}
