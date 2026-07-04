import { z } from 'zod';

import {
  retrieveProductContext,
  retrievePolicyContext,
} from '../../rag/retriever';

export type ToolRuntimeContext = {
  merchantId: string;
  conversationId?: string;
  customerEmail?: string;
};

type InferSchema<T extends z.ZodTypeAny> = z.infer<T>;

export type AgentTool<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: T;
  invoke: (input: InferSchema<T>) => Promise<string>;
};

function createTool<T extends z.ZodTypeAny>(config: {
  name: string;
  description: string;
  schema: T;
  handler: (input: InferSchema<T>) => Promise<unknown>;
}): AgentTool<T> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    invoke: async (input) => {
      const parsed = config.schema.parse(input);
      const result = await config.handler(parsed);
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  };
}

/**
 * Tool definitions (LangChain-compatible shape: name, description, schema, invoke).
 * Each tool is Zod-schema-validated.
 */
export function createAgentTools(ctx: ToolRuntimeContext) {
  const searchProducts = createTool({
    name: 'searchProducts',
    description: 'Search the merchant product catalog via RAG',
    schema: z.object({
      query: z.string(),
      topK: z.number().int().min(1).max(10).default(5),
    }),
    handler: async ({ query, topK }) => {
      const docs = await retrieveProductContext(ctx.merchantId, query, topK);
      return docs.map((d) => ({
        title: d.title,
        score: d.score,
        productId: d.source.productId,
        url: d.source.url,
        excerpt: d.content.slice(0, 400),
      }));
    },
  });

  const getProductDetails = createTool({
    name: 'getProductDetails',
    description: 'Get details for a specific product from the catalog',
    schema: z.object({ query: z.string() }),
    handler: async ({ query }) => {
      const docs = await retrieveProductContext(ctx.merchantId, query, 1);
      const doc = docs[0];
      if (!doc) {
        return { found: false };
      }
      return {
        found: true,
        title: doc.title,
        content: doc.content,
        productId: doc.source.productId,
        url: doc.source.url,
        price:
          typeof doc.metadata.price === 'string' ? doc.metadata.price : null,
      };
    },
  });

  const compareProducts = createTool({
    name: 'compareProducts',
    description: 'Compare multiple products using catalog context',
    schema: z.object({
      queries: z.array(z.string()).min(2).max(4),
    }),
    handler: async ({ queries }) =>
      Promise.all(
        queries.map(async (query) => {
          const docs = await retrieveProductContext(ctx.merchantId, query, 1);
          return docs[0]
            ? {
                title: docs[0].title,
                content: docs[0].content,
                productId: docs[0].source.productId,
                url: docs[0].source.url,
              }
            : { query, found: false };
        }),
      ),
  });

  const getReviews = createTool({
    name: 'getReviews',
    description: 'Find review-related product context',
    schema: z.object({ productQuery: z.string() }),
    handler: async ({ productQuery }) => {
      const docs = await retrieveProductContext(
        ctx.merchantId,
        `${productQuery} reviews ratings`,
        3,
      );
      return docs.map((d) => ({
        title: d.title,
        excerpt: d.content.slice(0, 300),
        productId: d.source.productId,
      }));
    },
  });

  const addToCart = createTool({
    name: 'addToCart',
    description: 'Request adding a product to the customer cart',
    schema: z.object({
      productId: z.string(),
      quantity: z.number().int().min(1).default(1),
      variantId: z.string().optional(),
    }),
    handler: async ({ productId, quantity, variantId }) => ({
      action: 'add_to_cart',
      productId,
      variantId: variantId ?? null,
      quantity,
      status: 'pending_host_execution',
    }),
  });

  const getOrderStatus = createTool({
    name: 'getOrderStatus',
    description: 'Fetch order status for the customer',
    schema: z.object({
      orderId: z.string().optional(),
      email: z.string().email().optional(),
    }),
    handler: async ({ orderId, email }) => ({
      action: 'get_order_status',
      orderId: orderId ?? null,
      email: email ?? ctx.customerEmail ?? null,
      status: 'pending_host_execution',
    }),
  });

  const getTrackingInfo = createTool({
    name: 'getTrackingInfo',
    description: 'Fetch real-time tracking from carrier APIs',
    schema: z.object({
      trackingNumber: z.string(),
      carrier: z.string().optional(),
    }),
    handler: async ({ trackingNumber, carrier }) => ({
      action: 'get_tracking_info',
      trackingNumber,
      carrier: carrier ?? null,
      status: 'pending_host_execution',
      timelineHint:
        'Host should return carrier checkpoints for visual timeline',
    }),
  });

  const explainDelay = createTool({
    name: 'explainDelay',
    description: 'Explain a shipment delay using known reason codes',
    schema: z.object({ reasonCode: z.string().optional() }),
    handler: async ({ reasonCode }) => ({
      action: 'explain_delay',
      reasonCode: reasonCode ?? 'unknown',
      message:
        'Delay explanations must be grounded in carrier/order context provided by host',
    }),
  });

  const offerCompensation = createTool({
    name: 'offerCompensation',
    description: 'Propose goodwill compensation within merchant policy',
    schema: z.object({
      type: z.enum(['discount', 'refund', 'replacement', 'store_credit']),
      amount: z.string().optional(),
      reason: z.string(),
    }),
    handler: async ({ type, amount, reason }) => ({
      action: 'offer_compensation',
      type,
      amount: amount ?? null,
      reason,
      status: 'pending_merchant_approval',
    }),
  });

  const checkReturnPolicy = createTool({
    name: 'checkReturnPolicy',
    description: 'Retrieve return/refund policy context',
    schema: z.object({ query: z.string().optional() }),
    handler: async ({ query }) => {
      const docs = await retrievePolicyContext(
        ctx.merchantId,
        query ?? 'return refund policy',
        3,
      );
      return docs.map((d) => ({
        title: d.title,
        content: d.content,
        url: d.source.url,
      }));
    },
  });

  const initiateReturn = createTool({
    name: 'initiateReturn',
    description: 'Start a return for an order',
    schema: z.object({
      orderId: z.string(),
      reason: z.string(),
      items: z.array(z.string()).optional(),
    }),
    handler: async ({ orderId, reason, items }) => ({
      action: 'initiate_return',
      orderId,
      reason,
      items: items ?? [],
      status: 'pending_host_execution',
    }),
  });

  const generateLabel = createTool({
    name: 'generateLabel',
    description: 'Generate a return shipping label',
    schema: z.object({
      orderId: z.string(),
      returnId: z.string().optional(),
    }),
    handler: async ({ orderId, returnId }) => ({
      action: 'generate_return_label',
      orderId,
      returnId: returnId ?? null,
      status: 'pending_host_execution',
    }),
  });

  const processExchange = createTool({
    name: 'processExchange',
    description: 'Process an exchange for a different variant/product',
    schema: z.object({
      orderId: z.string(),
      newVariantId: z.string(),
    }),
    handler: async ({ orderId, newVariantId }) => ({
      action: 'process_exchange',
      orderId,
      newVariantId,
      status: 'pending_host_execution',
    }),
  });

  const diagnoseCheckoutError = createTool({
    name: 'diagnoseCheckoutError',
    description: 'Diagnose common checkout failures',
    schema: z.object({
      errorCode: z.string().optional(),
      description: z.string().optional(),
    }),
    handler: async ({ errorCode, description }) => ({
      action: 'diagnose_checkout_error',
      errorCode: errorCode ?? null,
      description: description ?? null,
      commonFixes: [
        'Retry payment method',
        'Clear cart and re-add items',
        'Try another browser or disable extensions',
        'Confirm billing address matches card',
      ],
    }),
  });

  const checkPaymentStatus = createTool({
    name: 'checkPaymentStatus',
    description: 'Check payment status for an order or checkout',
    schema: z.object({
      orderId: z.string().optional(),
      checkoutId: z.string().optional(),
    }),
    handler: async ({ orderId, checkoutId }) => ({
      action: 'check_payment_status',
      orderId: orderId ?? null,
      checkoutId: checkoutId ?? null,
      status: 'pending_host_execution',
    }),
  });

  const resetCart = createTool({
    name: 'resetCart',
    description: 'Reset the customer cart to clear checkout issues',
    schema: z.object({}).default({}),
    handler: async () => ({
      action: 'reset_cart',
      status: 'pending_host_execution',
    }),
  });

  return {
    searchProducts,
    getProductDetails,
    compareProducts,
    getReviews,
    addToCart,
    getOrderStatus,
    getTrackingInfo,
    explainDelay,
    offerCompensation,
    checkReturnPolicy,
    initiateReturn,
    generateLabel,
    processExchange,
    diagnoseCheckoutError,
    checkPaymentStatus,
    resetCart,
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
