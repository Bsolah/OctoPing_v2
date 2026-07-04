export type PlanId = 'free' | 'growth' | 'scale' | 'enterprise';

export type PlanFeatures = {
  maxHumanAgents: number | null; // null = unlimited
  proactiveTriggers: boolean;
  analyticsRetentionDays: number;
  advancedAnalytics: boolean;
  prioritySupport: boolean;
  customIntegrations: boolean;
};

export type PlanDefinition = {
  id: PlanId;
  name: string;
  description: string;
  priceMonthlyUsd: number | null; // null = custom
  aiResolutionsPerMonth: number | null; // null = unlimited
  trialDays: number;
  features: PlanFeatures;
  shopifyPlanName: string;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Get started with AI support for small stores.',
    priceMonthlyUsd: 0,
    aiResolutionsPerMonth: 50,
    trialDays: 0,
    shopifyPlanName: 'Nova Support Free',
    features: {
      maxHumanAgents: 1,
      proactiveTriggers: false,
      analyticsRetentionDays: 14,
      advancedAnalytics: false,
      prioritySupport: false,
      customIntegrations: false,
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'For growing brands that need reliable AI coverage.',
    priceMonthlyUsd: 49,
    aiResolutionsPerMonth: 500,
    trialDays: 14,
    shopifyPlanName: 'Nova Support Growth',
    features: {
      maxHumanAgents: 5,
      proactiveTriggers: true,
      analyticsRetentionDays: 90,
      advancedAnalytics: true,
      prioritySupport: false,
      customIntegrations: false,
    },
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    description: 'Unlimited AI resolutions for high-volume stores.',
    priceMonthlyUsd: 149,
    aiResolutionsPerMonth: null,
    trialDays: 0,
    shopifyPlanName: 'Nova Support Scale',
    features: {
      maxHumanAgents: 25,
      proactiveTriggers: true,
      analyticsRetentionDays: 365,
      advancedAnalytics: true,
      prioritySupport: true,
      customIntegrations: false,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom pricing, SLAs, and dedicated support.',
    priceMonthlyUsd: null,
    aiResolutionsPerMonth: null,
    trialDays: 0,
    shopifyPlanName: 'Nova Support Enterprise',
    features: {
      maxHumanAgents: null,
      proactiveTriggers: true,
      analyticsRetentionDays: 730,
      advancedAnalytics: true,
      prioritySupport: true,
      customIntegrations: true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'growth', 'scale', 'enterprise'];

export function getPlan(planId: string | null | undefined): PlanDefinition {
  const key = (planId ?? 'free').toLowerCase() as PlanId;
  return PLANS[key] ?? PLANS.free;
}

export function isPaidPlan(planId: string | null | undefined): boolean {
  const plan = getPlan(planId);
  return plan.id !== 'free' && plan.priceMonthlyUsd !== 0;
}

export function listPlans(): PlanDefinition[] {
  return PLAN_ORDER.map((id) => PLANS[id]);
}

export function planAllowsFeature(
  planId: string | null | undefined,
  feature: keyof PlanFeatures,
): boolean {
  const value = getPlan(planId).features[feature];
  if (typeof value === 'boolean') return value;
  return true;
}

export function planAgentLimit(
  planId: string | null | undefined,
): number | null {
  return getPlan(planId).features.maxHumanAgents;
}
