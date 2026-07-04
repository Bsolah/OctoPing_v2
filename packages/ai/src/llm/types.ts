export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatResult = {
  content: string;
  model: string;
  provider: 'openai' | 'anthropic';
  usage: TokenUsage;
  costUsd: number;
  merchantId?: string;
  latencyMs: number;
};

export type StreamChunk = {
  type: 'token' | 'usage' | 'done' | 'error';
  content?: string;
  usage?: TokenUsage;
  costUsd?: number;
  model?: string;
  provider?: 'openai' | 'anthropic';
  error?: string;
  /** ms from stream start to first token */
  timeToFirstTokenMs?: number;
};
