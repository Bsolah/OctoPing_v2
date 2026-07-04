import { getLogger, withShopifySpan } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { decryptPII } from '@/lib/security';

import { normalizeShopDomain, SHOPIFY_API_VERSION } from './config';

export type ShopifyRateLimit = {
  currentlyAvailable: number;
  maximumAvailable: number;
  restoreRate: number;
};

export type ShopifyFetchResult<T> = {
  data: T;
  rateLimit?: ShopifyRateLimit;
};

type GraphQlError = { message: string };

async function getAccessTokenForShop(shop: string): Promise<string> {
  const shopDomain = normalizeShopDomain(shop);
  const merchant = await prisma.merchant.findUnique({
    where: { shopDomain },
  });

  if (!merchant || !merchant.isActive) {
    throw new Error(`Merchant not found or inactive: ${shopDomain}`);
  }

  return decryptPII(merchant.accessToken);
}

function parseRateLimitHeader(
  header: string | null,
): ShopifyRateLimit | undefined {
  if (!header) {
    return undefined;
  }

  // Format: "32/40" (REST) or GraphQL cost headers
  const parts = header.split('/');
  const used = Number(parts[0]);
  const max = Number(parts[1]);
  if (!Number.isFinite(used) || !Number.isFinite(max)) {
    return undefined;
  }

  return {
    currentlyAvailable: Math.max(0, max - used),
    maximumAvailable: max,
    restoreRate: 2,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Authenticated Shopify Admin GraphQL request with token decryption and rate-limit handling.
 */
export async function shopifyFetch<T>(
  shop: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<ShopifyFetchResult<T>> {
  const shopDomain = normalizeShopDomain(shop);

  return withShopifySpan({ merchantId: shopDomain }, async () => {
    const accessToken = await getAccessTokenForShop(shopDomain);
    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    let attempt = 0;
    while (attempt < 5) {
      attempt += 1;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      const rateLimit = parseRateLimitHeader(
        response.headers.get('X-Shopify-Shop-Api-Call-Limit'),
      );

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
        getLogger().warn(
          { shop: shopDomain, attempt, retryAfter },
          'Shopify rate limited',
        );
        await sleep(retryAfter * 1000);
        continue;
      }

      if (
        rateLimit &&
        rateLimit.currentlyAvailable <= 2 &&
        rateLimit.maximumAvailable > 0
      ) {
        await sleep(500);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shopify GraphQL HTTP ${response.status}: ${text}`);
      }

      const payload = (await response.json()) as {
        data?: T;
        errors?: GraphQlError[];
        extensions?: {
          cost?: {
            throttleStatus?: {
              currentlyAvailable?: number;
              maximumAvailable?: number;
              restoreRate?: number;
            };
          };
        };
      };

      if (payload.errors?.length) {
        const throttle = payload.errors.some((e) =>
          e.message.toLowerCase().includes('throttled'),
        );
        if (throttle) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new Error(
          `Shopify GraphQL errors: ${payload.errors.map((e) => e.message).join('; ')}`,
        );
      }

      if (!payload.data) {
        throw new Error('Shopify GraphQL response missing data');
      }

      const costLimit = payload.extensions?.cost?.throttleStatus;
      const gqlRateLimit: ShopifyRateLimit | undefined = costLimit
        ? {
            currentlyAvailable: costLimit.currentlyAvailable ?? 0,
            maximumAvailable: costLimit.maximumAvailable ?? 0,
            restoreRate: costLimit.restoreRate ?? 0,
          }
        : rateLimit;

      return { data: payload.data, rateLimit: gqlRateLimit };
    }

    throw new Error('Shopify GraphQL request failed after retries');
  });
}

type Connection<T> = {
  edges: Array<{ cursor: string; node: T }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
};

/**
 * Cursor-based pagination helper for Shopify connections.
 */
export async function paginateConnection<T>(options: {
  shop: string;
  pageQuery: string;
  variables?: Record<string, unknown>;
  connectionPath: string;
  pageSize?: number;
}): Promise<T[]> {
  const pageSize = options.pageSize ?? 50;
  const nodes: T[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const { data } = await shopifyFetch<Record<string, unknown>>(
      options.shop,
      options.pageQuery,
      {
        ...options.variables,
        first: pageSize,
        after: cursor,
      },
    );

    const connection = options.connectionPath
      .split('.')
      .reduce<unknown>((acc, key) => {
        if (acc && typeof acc === 'object') {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, data) as Connection<T> | undefined;

    if (!connection) {
      break;
    }

    for (const edge of connection.edges) {
      nodes.push(edge.node);
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor ?? null;
  }

  return nodes;
}

export async function getShopDetails(shop: string) {
  const query = `
    query GetShopDetails {
      shop {
        id
        name
        email
        myshopifyDomain
        primaryDomain { url }
        plan { displayName }
        currencyCode
      }
    }
  `;

  const { data } = await shopifyFetch<{
    shop: {
      id: string;
      name: string;
      email: string;
      myshopifyDomain: string;
      primaryDomain?: { url: string };
      plan?: { displayName: string };
      currencyCode: string;
    };
  }>(shop, query);

  return data.shop;
}

export async function getProducts(shop: string) {
  const pageQuery = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            handle
            description
            status
            vendor
            productType
            tags
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  return paginateConnection<{
    id: string;
    title: string;
    handle: string;
    description: string;
    status: string;
    vendor: string;
    productType: string;
    tags: string[];
  }>({
    shop,
    pageQuery,
    connectionPath: 'products',
  });
}

export async function getOrders(shop: string, queryFilter?: string) {
  const pageQuery = `
    query GetOrders($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            name
            email
            createdAt
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            fulfillments {
              trackingInfo { number company }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  return paginateConnection<{
    id: string;
    name: string;
    email?: string | null;
    createdAt: string;
    displayFulfillmentStatus?: string | null;
    totalPriceSet?: { shopMoney: { amount: string; currencyCode: string } };
    fulfillments?: Array<{
      trackingInfo: Array<{ number?: string; company?: string }>;
    }>;
  }>({
    shop,
    pageQuery,
    variables: { query: queryFilter ?? 'created_at:>=2020-01-01' },
    connectionPath: 'orders',
  });
}

export async function getCustomer(shop: string, customerId: string) {
  const query = `
    query GetCustomer($id: ID!) {
      customer(id: $id) {
        id
        email
        firstName
        lastName
        phone
        createdAt
      }
    }
  `;

  const { data } = await shopifyFetch<{
    customer: {
      id: string;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      createdAt: string;
    } | null;
  }>(shop, query, { id: customerId });

  return data.customer;
}

export async function updateOrder(shop: string, orderId: string, note: string) {
  const query = `
    mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyFetch<{
    orderUpdate: {
      order?: { id: string; note?: string };
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(shop, query, { input: { id: orderId, note } });

  if (data.orderUpdate.userErrors.length > 0) {
    throw new Error(
      data.orderUpdate.userErrors.map((e) => e.message).join('; '),
    );
  }

  return data.orderUpdate.order;
}

export async function createDraftOrder(
  shop: string,
  input: {
    email?: string;
    lineItems: Array<{ variantId: string; quantity: number }>;
    note?: string;
  },
) {
  const query = `
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name invoiceUrl }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyFetch<{
    draftOrderCreate: {
      draftOrder?: { id: string; name: string; invoiceUrl?: string };
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(shop, query, {
    input: {
      email: input.email,
      note: input.note,
      lineItems: input.lineItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    },
  });

  if (data.draftOrderCreate.userErrors.length > 0) {
    throw new Error(
      data.draftOrderCreate.userErrors.map((e) => e.message).join('; '),
    );
  }

  return data.draftOrderCreate.draftOrder;
}

export async function getShopPolicies(shop: string) {
  const query = `
    query GetShopPolicies {
      shop {
        refundPolicy { title body url }
        privacyPolicy { title body url }
        shippingPolicy { title body url }
        termsOfService { title body url }
      }
    }
  `;

  const { data } = await shopifyFetch<{
    shop: {
      refundPolicy?: { title?: string; body?: string; url?: string } | null;
      privacyPolicy?: { title?: string; body?: string; url?: string } | null;
      shippingPolicy?: { title?: string; body?: string; url?: string } | null;
      termsOfService?: { title?: string; body?: string; url?: string } | null;
    };
  }>(shop, query);

  const policies: Array<{
    type: string;
    title: string;
    body: string;
    url?: string;
  }> = [];

  const mapping: Array<[string, typeof data.shop.refundPolicy]> = [
    ['REFUND', data.shop.refundPolicy],
    ['PRIVACY', data.shop.privacyPolicy],
    ['SHIPPING', data.shop.shippingPolicy],
    ['TERMS', data.shop.termsOfService],
  ];

  for (const [type, policy] of mapping) {
    if (policy?.body) {
      policies.push({
        type,
        title: policy.title ?? type,
        body: policy.body,
        url: policy.url,
      });
    }
  }

  return policies;
}

export function gidToNumericId(gid: string): bigint {
  const parts = gid.split('/');
  const id = parts[parts.length - 1];
  return BigInt(id ?? '0');
}
