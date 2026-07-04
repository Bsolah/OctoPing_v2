const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
).replace(/\/$/, '');

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setTokenGetter(getter: TokenGetter) {
  tokenGetter = getter;
}

async function resolveToken(): Promise<string> {
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) return token;
  }

  if (typeof window !== 'undefined') {
    const stored = window.sessionStorage.getItem('nova_dashboard_token');
    if (stored) return stored;
  }

  const devToken = process.env.NEXT_PUBLIC_DEV_TOKEN;
  if (devToken) return devToken;

  throw new Error('Not authenticated');
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await resolveToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      data?.error?.message ?? 'Request failed',
      response.status,
      data?.error,
    );
  }

  return data as T;
}

export const api = {
  getMerchant: () => apiFetch<MerchantProfile>('/api/v1/merchant/me'),
  updateSettings: (body: Record<string, unknown>) =>
    apiFetch('/api/v1/merchant/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getDashboard: (params?: string) =>
    apiFetch<DashboardMetrics>(
      `/api/v1/analytics/dashboard${params ? `?${params}` : ''}`,
    ),
  getConversations: (params?: string) =>
    apiFetch<ConversationListResponse>(
      `/api/v1/conversations${params ? `?${params}` : ''}`,
    ),
  getConversation: (id: string) =>
    apiFetch<ConversationDetail>(`/api/v1/conversations/${id}`),
  sendMessage: (id: string, content: string) =>
    apiFetch(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, stream: false }),
    }),
  escalate: (id: string, reason?: string) =>
    apiFetch(`/api/v1/conversations/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  getAnalyticsConversations: (params?: string) =>
    apiFetch<{
      items: Array<
        ConversationSummary & {
          endedAt?: string | null;
          intents?: string[];
          avgConfidence?: number | null;
        }
      >;
      cached?: boolean;
    }>(`/api/v1/analytics/conversations${params ? `?${params}` : ''}`),

  getRevenue: (params?: string) =>
    apiFetch<RevenueResponse>(
      `/api/v1/analytics/revenue${params ? `?${params}` : ''}`,
    ),
  listKnowledgeBase: () =>
    apiFetch<{ items: KnowledgeBaseEntry[] }>(
      '/api/v1/merchant/knowledge-base',
    ),
  createKnowledgeBase: (body: Record<string, unknown>) =>
    apiFetch('/api/v1/merchant/knowledge-base', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteKnowledgeBase: (id: string) =>
    apiFetch(`/api/v1/merchant/knowledge-base/${id}`, { method: 'DELETE' }),
  suggestReply: (conversationId: string, draft?: string) => {
    const params = new URLSearchParams({ conversationId });
    if (draft?.trim()) params.set('draft', draft.trim());
    return apiFetch<{ suggestions: string[]; latencyMs?: number }>(
      `/api/v1/ai/suggest?${params.toString()}`,
    );
  },
  getAgentMe: () => apiFetch<AgentProfile>('/api/v1/agents/me'),
  setAgentStatus: (status: AgentPresenceStatus) =>
    apiFetch<{ ok: boolean; status: AgentPresenceStatus }>(
      '/api/v1/agents/status',
      { method: 'POST', body: JSON.stringify({ status }) },
    ),
  getAgentQueue: () => apiFetch<AgentQueueResponse>('/api/v1/agents/queue'),
  claimConversation: (conversationId: string) =>
    apiFetch(`/api/v1/agents/${conversationId}/claim`, { method: 'POST' }),
  resolveConversation: (
    conversationId: string,
    body: { releaseToAi?: boolean; note?: string } = {},
  ) =>
    apiFetch(`/api/v1/agents/${conversationId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getAgentNotes: (conversationId: string) =>
    apiFetch<{ items: AgentNote[] }>(`/api/v1/agents/${conversationId}/notes`),
  addAgentNote: (conversationId: string, body: string) =>
    apiFetch(`/api/v1/agents/${conversationId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  getBillingPlan: () => apiFetch<BillingPlanResponse>('/api/v1/billing/plan'),
  getBillingUsage: (period?: string) =>
    apiFetch<BillingUsageResponse>(
      `/api/v1/billing/usage${period ? `?period=${period}` : ''}`,
    ),
  upgradePlan: (plan: string) =>
    apiFetch<BillingUpgradeResponse>('/api/v1/billing/upgrade', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
  cancelBilling: () =>
    apiFetch<BillingCancelResponse>('/api/v1/billing/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getBillingInvoices: () =>
    apiFetch<{ items: BillingInvoice[] }>('/api/v1/billing/invoices'),
  getWsUrl: () => API_URL.replace(/^http/, 'ws'),
};

export type MerchantProfile = {
  id: string;
  shopDomain: string;
  planTier: string;
  aiTone: string;
  escalationThreshold: number;
  aiRules: string[];
  widgetConfig: Record<string, unknown>;
  isActive: boolean;
};

export type DashboardMetrics = {
  period: { from: string; to: string };
  cached?: boolean;
  metrics: {
    conversations: number;
    resolved: number;
    escalated: number;
    aiResolved: number;
    aiResolutionRate: number;
    avgResponseMs?: number | null;
    csatScore?: number | null;
    revenueRecovered: number | string;
    recoveredCartValue?: number;
    savedOrderValue?: number;
    upsellValue?: number;
    controlConversionRate?: number | null;
    treatmentConversionRate?: number | null;
    conversionLift?: number | null;
  };
  series?: Array<{ day: string; conversations: number; revenue: number }>;
};

export type ConversationSummary = {
  id: string;
  status: string;
  channel: string;
  customerEmail?: string | null;
  createdAt: string;
  updatedAt?: string;
  messages?: Array<{ content: string; createdAt: string }>;
  revenueImpact?: number | string | null;
  aiResolution?: boolean;
};

export type ConversationListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ConversationSummary[];
};

export type ConversationDetail = Omit<ConversationSummary, 'messages'> & {
  messages: Array<{
    id: string;
    senderType: string;
    content: string;
    createdAt: string;
    aiConfidence?: number | null;
    aiIntent?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type KnowledgeBaseEntry = {
  id: string;
  contentType: string;
  title: string;
  content: string;
  createdAt: string;
};

export type RevenueResponse = {
  period: { from: string; to: string };
  cached?: boolean;
  totalRevenueAttributed: number;
  directRevenue?: number;
  influenceRevenue?: number;
  recoveredCartValue?: number;
  savedOrderValue?: number;
  upsellValue?: number;
  roi?: number | null;
  items: Array<
    ConversationSummary & {
      conversationId?: string;
      attributionType?: string;
      revenueType?: string;
      amount?: number;
      attributedAt?: string;
    }
  >;
};

export type AgentPresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export type AgentProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar?: string | null;
  isOnline: boolean;
  workingHours?: unknown;
  presence: AgentPresenceStatus;
};

export type EscalationContextPackage = {
  conversationSummary?: string;
  customerProfile?: {
    email?: string | null;
    tags?: string[];
    orderCount?: number;
    ltv?: number;
  };
  orderHistory?: Array<{
    id: string;
    shopifyOrderId: string;
    status?: string | null;
    totalPrice?: string | null;
    trackingNumbers?: string[];
    trackingStatus?: string | null;
    carrier?: string | null;
    createdAt: string;
  }>;
  aiReasoningChain?: Array<{
    messageId: string;
    intent?: string | null;
    confidence?: number | null;
    toolsUsed?: string[];
    excerpt?: string;
  }>;
  suggestedHumanResponse?: string;
  priorityScore?: number;
  priorityLabel?: 'low' | 'medium' | 'high' | 'urgent';
  assembledInMs?: number;
};

export type AgentQueueItem = {
  id: string;
  status: string;
  channel: string;
  customerEmail?: string | null;
  priority: number;
  assignedAgentId?: string | null;
  queuedAt?: string | null;
  slaDueAt?: string | null;
  aiPaused: boolean;
  escalationContext?: EscalationContextPackage | null;
  preview?: string | null;
  updatedAt: string;
  createdAt: string;
};

export type AgentQueueResponse = {
  agentId: string;
  items: AgentQueueItem[];
};

export type AgentNote = {
  id: string;
  eventType: string;
  properties: {
    body?: string;
    agentId?: string;
    agentName?: string;
  };
  createdAt: string;
};

export type PlanDefinition = {
  id: string;
  name: string;
  description: string;
  priceMonthlyUsd: number | null;
  aiResolutionsPerMonth: number | null;
  trialDays: number;
  shopifyPlanName: string;
  features: {
    maxHumanAgents: number | null;
    proactiveTriggers: boolean;
    analyticsRetentionDays: number;
    advancedAnalytics: boolean;
    prioritySupport: boolean;
    customIntegrations: boolean;
  };
};

export type UsageSnapshot = {
  merchantId: string;
  planId: string;
  periodKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  softWarning: boolean;
  hardLimited: boolean;
  inGracePeriod: boolean;
  gracePeriodEndsAt: string | null;
  allowed: boolean;
  humanOnlyMessage: string | null;
};

export type BillingPlanResponse = {
  plan: PlanDefinition;
  planTier: string;
  subscription: {
    id?: string | null;
    status?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelledAt?: string | null;
    gracePeriodEndsAt?: string | null;
    test?: boolean;
  };
  usage: UsageSnapshot;
  plans: PlanDefinition[];
};

export type BillingUsageResponse = {
  usage: UsageSnapshot;
  history: Array<{ day: string; count: number }>;
  period: string;
};

export type BillingUpgradeResponse = {
  ok: boolean;
  planTier: string;
  confirmationUrl?: string | null;
  subscriptionId?: string | null;
  message?: string;
};

export type BillingCancelResponse = {
  ok: boolean;
  planTier: string;
  subscriptionStatus?: string | null;
  cancelledAt?: string | null;
  usage: UsageSnapshot;
};

export type BillingInvoice = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  currentPeriodEnd?: string | null;
  price?: number | null;
  currencyCode?: string | null;
};
