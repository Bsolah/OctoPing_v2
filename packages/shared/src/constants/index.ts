import type { PlanId } from '../types';

export const SUPPORTED_LANGUAGES = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const AI_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
] as const;

export type AiModel = (typeof AI_MODELS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPrice: number;
  conversationLimit: number | null;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    conversationLimit: 50,
  },
  {
    id: 'starter',
    name: 'Starter',
    monthlyPrice: 29,
    conversationLimit: 500,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 99,
    conversationLimit: 2500,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 299,
    conversationLimit: null,
  },
] as const;
