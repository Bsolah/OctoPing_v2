import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import {
  calculateCostUsd,
  getChatModelConfig,
  MODELS,
  type ChatModelId,
} from './models';
import type {
  ChatMessage,
  ChatResult,
  StreamChunk,
  TokenUsage,
  ToolDefinition,
} from './types';

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000;

type Provider = 'openai' | 'anthropic';

type MerchantUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
};

const merchantUsage = new Map<string, MerchantUsage>();

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let openaiFailures = 0;
let circuitOpenedAt = 0;
let preferredProvider: Provider = 'openai';

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for fallback');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function isCircuitOpen(): boolean {
  if (openaiFailures < CIRCUIT_FAILURE_THRESHOLD) {
    return false;
  }
  if (Date.now() - circuitOpenedAt > CIRCUIT_RESET_MS) {
    openaiFailures = 0;
    preferredProvider = 'openai';
    return false;
  }
  return true;
}

function recordOpenAIFailure(): void {
  openaiFailures += 1;
  if (openaiFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    preferredProvider = 'anthropic';
    circuitOpenedAt = Date.now();
  }
}

function recordOpenAISuccess(): void {
  openaiFailures = 0;
  preferredProvider = 'openai';
}

function trackMerchantUsage(
  merchantId: string | undefined,
  usage: TokenUsage,
  costUsd: number,
): void {
  if (!merchantId) {
    return;
  }
  const current = merchantUsage.get(merchantId) ?? {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    requests: 0,
  };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.costUsd += costUsd;
  current.requests += 1;
  merchantUsage.set(merchantId, current);
}

export function getMerchantCost(merchantId: string): MerchantUsage {
  return (
    merchantUsage.get(merchantId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    }
  );
}

export function resetMerchantCost(merchantId?: string): void {
  if (merchantId) {
    merchantUsage.delete(merchantId);
    return;
  }
  merchantUsage.clear();
}

function resolveProvider(model: ChatModelId): Provider {
  const config = getChatModelConfig(model);
  if (config.provider === 'anthropic') {
    return 'anthropic';
  }
  if (isCircuitOpen()) {
    return 'anthropic';
  }
  return preferredProvider;
}

function toOpenAIMessages(
  messages: ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? 'tool',
      };
    }
    return {
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
    };
  });
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const converted: Anthropic.MessageParam[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  return { system, messages: converted };
}

function toolsToOpenAI(
  tools?: ToolDefinition[],
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function chatOpenAI(
  messages: ChatMessage[],
  model: ChatModelId,
  tools?: ToolDefinition[],
): Promise<ChatResult> {
  const started = Date.now();
  const response = await getOpenAI().chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    tools: toolsToOpenAI(tools),
  });

  const usage: TokenUsage = {
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };

  const costUsd = calculateCostUsd(
    model,
    usage.inputTokens,
    usage.outputTokens,
  );
  recordOpenAISuccess();

  return {
    content: response.choices[0]?.message?.content ?? '',
    model,
    provider: 'openai',
    usage,
    costUsd,
    latencyMs: Date.now() - started,
  };
}

async function chatAnthropic(
  messages: ChatMessage[],
  model: ChatModelId = MODELS.fallback.id,
): Promise<ChatResult> {
  const started = Date.now();
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 2048,
    system: system || undefined,
    messages: anthropicMessages,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };

  const costUsd = calculateCostUsd(
    model,
    usage.inputTokens,
    usage.outputTokens,
  );

  return {
    content: text,
    model,
    provider: 'anthropic',
    usage,
    costUsd,
    latencyMs: Date.now() - started,
  };
}

/**
 * Non-streaming chat with OpenAI primary and Anthropic fallback.
 */
export async function chat(
  messages: ChatMessage[],
  model: ChatModelId = MODELS.primary.id,
  options: { merchantId?: string; tools?: ToolDefinition[] } = {},
): Promise<ChatResult> {
  const provider = resolveProvider(model);

  try {
    const result =
      provider === 'anthropic'
        ? await chatAnthropic(messages, MODELS.fallback.id)
        : await chatOpenAI(messages, model, options.tools);

    trackMerchantUsage(options.merchantId, result.usage, result.costUsd);
    return { ...result, merchantId: options.merchantId };
  } catch (error) {
    if (provider === 'openai') {
      recordOpenAIFailure();
      const fallback = await chatAnthropic(messages, MODELS.fallback.id);
      trackMerchantUsage(options.merchantId, fallback.usage, fallback.costUsd);
      return { ...fallback, merchantId: options.merchantId };
    }
    throw error;
  }
}

/**
 * Streaming chat — yields tokens as they arrive (target TTFT < 500ms).
 */
export async function* streamChat(
  messages: ChatMessage[],
  model: ChatModelId = MODELS.primary.id,
  tools?: ToolDefinition[],
  options: { merchantId?: string } = {},
): AsyncGenerator<StreamChunk> {
  const provider = resolveProvider(model);
  const started = Date.now();
  let firstTokenAt: number | undefined;
  let outputText = '';

  try {
    if (provider === 'anthropic') {
      yield* streamAnthropic(messages, started, options.merchantId);
      return;
    }

    const stream = await getOpenAI().chat.completions.create({
      model,
      messages: toOpenAIMessages(messages),
      tools: toolsToOpenAI(tools),
      stream: true,
      stream_options: { include_usage: true },
    });

    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        if (firstTokenAt === undefined) {
          firstTokenAt = Date.now();
        }
        outputText += delta;
        yield {
          type: 'token',
          content: delta,
          timeToFirstTokenMs: firstTokenAt - started,
        };
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }
    }

    // Estimate output tokens if usage not provided
    if (usage.totalTokens === 0) {
      usage.outputTokens = Math.ceil(outputText.length / 4);
      usage.totalTokens = usage.outputTokens;
    }

    const costUsd = calculateCostUsd(
      model,
      usage.inputTokens,
      usage.outputTokens,
    );
    trackMerchantUsage(options.merchantId, usage, costUsd);
    recordOpenAISuccess();

    yield { type: 'usage', usage, costUsd, model, provider: 'openai' };
    yield {
      type: 'done',
      content: outputText,
      usage,
      costUsd,
      model,
      provider: 'openai',
      timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : undefined,
    };
  } catch (error) {
    if (provider === 'openai') {
      recordOpenAIFailure();
      yield* streamAnthropic(messages, started, options.merchantId);
      return;
    }

    yield {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function* streamAnthropic(
  messages: ChatMessage[],
  started: number,
  merchantId?: string,
): AsyncGenerator<StreamChunk> {
  const model = MODELS.fallback.id;
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
  let firstTokenAt: number | undefined;
  let outputText = '';

  const stream = getAnthropic().messages.stream({
    model,
    max_tokens: 2048,
    system: system || undefined,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      if (firstTokenAt === undefined) {
        firstTokenAt = Date.now();
      }
      outputText += event.delta.text;
      yield {
        type: 'token',
        content: event.delta.text,
        timeToFirstTokenMs: firstTokenAt - started,
      };
    }
  }

  const finalMessage = await stream.finalMessage();
  const usage: TokenUsage = {
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
    totalTokens:
      finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
  };
  const costUsd = calculateCostUsd(
    model,
    usage.inputTokens,
    usage.outputTokens,
  );
  trackMerchantUsage(merchantId, usage, costUsd);

  yield { type: 'usage', usage, costUsd, model, provider: 'anthropic' };
  yield {
    type: 'done',
    content: outputText,
    usage,
    costUsd,
    model,
    provider: 'anthropic',
    timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : undefined,
  };
}

export function getCircuitBreakerState(): {
  provider: Provider;
  openaiFailures: number;
  isOpen: boolean;
} {
  return {
    provider: preferredProvider,
    openaiFailures,
    isOpen: isCircuitOpen(),
  };
}
