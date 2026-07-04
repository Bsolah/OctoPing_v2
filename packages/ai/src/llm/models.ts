export type ChatModelId =
  'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet-20241022';

export type EmbeddingModelId = 'text-embedding-3-small';

export type ModelProvider = 'openai' | 'anthropic';

export type ModelConfig = {
  id: ChatModelId | EmbeddingModelId;
  provider: ModelProvider;
  role: 'primary' | 'fast' | 'fallback' | 'embedding';
  description: string;
  contextWindow: number;
  /** USD per 1M input tokens */
  inputCostPer1M: number;
  /** USD per 1M output tokens */
  outputCostPer1M: number;
  dimensions?: number;
};

export const MODELS = {
  primary: {
    id: 'gpt-4o',
    provider: 'openai',
    role: 'primary',
    description: 'Primary reasoning model',
    contextWindow: 128_000,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10,
  },
  fast: {
    id: 'gpt-4o-mini',
    provider: 'openai',
    role: 'fast',
    description: 'Fast, low-cost model',
    contextWindow: 128_000,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
  fallback: {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    role: 'fallback',
    description: 'Anthropic fallback when OpenAI is unavailable',
    contextWindow: 200_000,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  embedding: {
    id: 'text-embedding-3-small',
    provider: 'openai',
    role: 'embedding',
    description: 'Embedding model (1536 dimensions)',
    contextWindow: 8_191,
    inputCostPer1M: 0.02,
    outputCostPer1M: 0,
    dimensions: 1536,
  },
} as const satisfies Record<string, ModelConfig>;

export const EMBEDDING_DIMENSIONS = MODELS.embedding.dimensions;

export const CONTEXT_BUDGET = {
  historyTokens: 4000,
  ragTokens: 2000,
  systemTokens: 1000,
} as const;

export function getChatModelConfig(model: ChatModelId): ModelConfig {
  const match = Object.values(MODELS).find((m) => m.id === model);
  if (!match || match.role === 'embedding') {
    throw new Error(`Unknown chat model: ${model}`);
  }
  return match;
}

export function calculateCostUsd(
  model: ChatModelId | EmbeddingModelId,
  inputTokens: number,
  outputTokens = 0,
): number {
  const config =
    Object.values(MODELS).find((m) => m.id === model) ?? MODELS.primary;
  return (
    (inputTokens / 1_000_000) * config.inputCostPer1M +
    (outputTokens / 1_000_000) * config.outputCostPer1M
  );
}
