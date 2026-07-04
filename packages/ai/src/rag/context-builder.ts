import { countTokens } from '../embeddings/generator';
import { CONTEXT_BUDGET } from '../llm/models';
import type { ChatMessage } from '../llm/types';
import type { RetrievedDocument } from './retriever';

export type MerchantPromptConfig = {
  id: string;
  shopName: string;
  shopDomain: string;
  tone: string;
  rules?: string[];
};

export type CustomerProfile = {
  email?: string;
  name?: string;
  shopifyCustomerId?: string;
};

export type OrderSummary = {
  id: string;
  orderNumber?: string;
  status?: string;
  totalPrice?: string;
  trackingNumbers?: string[];
  carrier?: string;
  createdAt?: string;
};

export type PastConversationSummary = {
  id: string;
  subject?: string;
  status?: string;
  channel?: string;
  createdAt?: string;
  lastMessage?: string;
};

export type CartSummary = {
  itemCount?: number;
  totalPrice?: string;
  items?: Array<{ title: string; quantity: number; price?: string }>;
};

export type ConversationRecord = {
  id: string;
  merchantId: string;
  customerEmail?: string | null;
  channel?: string;
  status?: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
};

export type CustomerContextStore = {
  getConversation(conversationId: string): Promise<ConversationRecord | null>;
  getCustomerOrders(merchantId: string, email: string): Promise<OrderSummary[]>;
  getPastConversations(
    merchantId: string,
    email: string,
    limit?: number,
  ): Promise<PastConversationSummary[]>;
  getCart?(merchantId: string, email: string): Promise<CartSummary | null>;
};

export type CustomerContext = {
  conversationId: string;
  merchantId: string;
  customer: CustomerProfile;
  orders: OrderSummary[];
  cart: CartSummary | null;
  pastConversations: PastConversationSummary[];
  recentMessages: Array<{ role: string; content: string }>;
};

/**
 * Build customer context from the data store (DB adapter provided by the app).
 */
export async function buildCustomerContext(
  conversationId: string,
  store: CustomerContextStore,
): Promise<CustomerContext | null> {
  const conversation = await store.getConversation(conversationId);
  if (!conversation) {
    return null;
  }

  const email = conversation.customerEmail ?? undefined;
  const [orders, pastConversations, cart] = await Promise.all([
    email
      ? store.getCustomerOrders(conversation.merchantId, email)
      : Promise.resolve([]),
    email
      ? store.getPastConversations(conversation.merchantId, email, 5)
      : Promise.resolve([]),
    email && store.getCart
      ? store.getCart(conversation.merchantId, email)
      : Promise.resolve(null),
  ]);

  return {
    conversationId,
    merchantId: conversation.merchantId,
    customer: {
      email,
    },
    orders,
    cart,
    pastConversations,
    recentMessages: conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
}

/**
 * Construct the system prompt with merchant tone and rules.
 */
export function buildSystemPrompt(
  merchant: MerchantPromptConfig,
  tone: string,
  rules: string[] = [],
  basePrompt: string,
): string {
  const ruleBlock =
    rules.length > 0
      ? rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')
      : 'None specified.';

  return basePrompt
    .replaceAll('[shopName]', merchant.shopName)
    .replaceAll('[shopDomain]', merchant.shopDomain)
    .replaceAll('[tone]', tone || merchant.tone || 'friendly_professional')
    .replaceAll('[rules]', ruleBlock);
}

function trimToTokenBudget(text: string, budget: number): string {
  if (countTokens(text) <= budget) {
    return text;
  }

  // Approximate trim by characters (~4 chars/token)
  const maxChars = budget * 4;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}

/**
 * Convert customer + RAG context into an LLM message array within token budgets.
 */
export function formatContextForLLM(options: {
  systemPrompt: string;
  customerContext?: CustomerContext | null;
  ragDocuments?: RetrievedDocument[];
  userMessage: string;
}): ChatMessage[] {
  const system = trimToTokenBudget(
    options.systemPrompt,
    CONTEXT_BUDGET.systemTokens,
  );

  const historyMessages = (options.customerContext?.recentMessages ?? [])
    .filter(
      (m) =>
        m.role === 'user' ||
        m.role === 'assistant' ||
        m.role === 'customer' ||
        m.role === 'ai',
    )
    .map((m) => ({
      role: (m.role === 'customer'
        ? 'user'
        : m.role === 'ai'
          ? 'assistant'
          : m.role) as 'user' | 'assistant',
      content: m.content,
    }));

  // Fit history into budget (keep most recent)
  const history: ChatMessage[] = [];
  let historyTokens = 0;
  for (let i = historyMessages.length - 1; i >= 0; i -= 1) {
    const message = historyMessages[i]!;
    const tokens = countTokens(message.content) + 4;
    if (historyTokens + tokens > CONTEXT_BUDGET.historyTokens) {
      break;
    }
    history.unshift(message);
    historyTokens += tokens;
  }

  const ragBlocks = (options.ragDocuments ?? []).map((doc, index) => {
    const citation = [
      `Source ${index + 1}: ${doc.source.title}`,
      doc.source.productId ? `product_id=${doc.source.productId}` : null,
      doc.source.url ? `url=${doc.source.url}` : null,
      `score=${doc.score.toFixed(3)}`,
      doc.content,
    ]
      .filter(Boolean)
      .join('\n');
    return citation;
  });

  let ragText = ragBlocks.join('\n\n---\n\n');
  ragText = trimToTokenBudget(ragText, CONTEXT_BUDGET.ragTokens);

  const contextParts: string[] = [];

  if (options.customerContext) {
    const ctx = options.customerContext;
    contextParts.push(
      `Customer: ${ctx.customer.email ?? 'unknown'}`,
      `Orders: ${JSON.stringify(ctx.orders.slice(0, 5))}`,
      ctx.cart ? `Cart: ${JSON.stringify(ctx.cart)}` : 'Cart: none',
      `Past conversations: ${JSON.stringify(ctx.pastConversations.slice(0, 3))}`,
    );
  }

  if (ragText) {
    contextParts.push(`Knowledge base context:\n${ragText}`);
  }

  const contextMessage: ChatMessage | null = contextParts.length
    ? {
        role: 'system',
        content: trimToTokenBudget(
          contextParts.join('\n\n'),
          CONTEXT_BUDGET.ragTokens + 500,
        ),
      }
    : null;

  return [
    { role: 'system', content: system },
    ...(contextMessage ? [contextMessage] : []),
    ...history,
    { role: 'user', content: options.userMessage },
  ];
}
