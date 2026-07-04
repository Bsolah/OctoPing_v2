import { chat, streamChat } from '../llm/client';
import { MODELS, type ChatModelId } from '../llm/models';
import type { ChatMessage, ChatResult, StreamChunk } from '../llm/types';
import { buildSystemPrompt, formatContextForLLM } from '../rag/context-builder';
import {
  retrieveProductContext,
  type RetrievedDocument,
} from '../rag/retriever';
import { getPreSalePrompt } from '../prompts/pre-sale';
import { getSystemPrompt } from '../prompts/system';
import type { PromptVersion } from '../prompts/types';

export type AnswerProductQuestionOptions = {
  merchantId: string;
  shopName: string;
  shopDomain: string;
  question: string;
  tone?: string;
  rules?: string[];
  model?: ChatModelId;
  promptVersion?: PromptVersion;
  agent?: 'system' | 'pre_sale';
  stream?: boolean;
};

export type ProductAnswer = ChatResult & {
  documents: RetrievedDocument[];
  messages: ChatMessage[];
  promptVersion: PromptVersion;
};

function buildMessages(
  options: AnswerProductQuestionOptions,
  documents: RetrievedDocument[],
) {
  const version = options.promptVersion ?? 'prompt_v1';
  const agentPrompt =
    options.agent === 'pre_sale'
      ? getPreSalePrompt(version)
      : getSystemPrompt(version);

  const systemPrompt = buildSystemPrompt(
    {
      id: options.merchantId,
      shopName: options.shopName,
      shopDomain: options.shopDomain,
      tone: options.tone ?? 'friendly_professional',
      rules: options.rules,
    },
    options.tone ?? 'friendly_professional',
    options.rules ?? [],
    agentPrompt.template,
  );

  return formatContextForLLM({
    systemPrompt,
    ragDocuments: documents,
    userMessage: options.question,
  });
}

/**
 * End-to-end product Q&A: RAG retrieve → prompt → LLM.
 */
export async function answerProductQuestion(
  options: AnswerProductQuestionOptions,
): Promise<ProductAnswer | AsyncGenerator<StreamChunk>> {
  const documents = await retrieveProductContext(
    options.merchantId,
    options.question,
    5,
  );

  const messages = buildMessages(options, documents);
  const model = options.model ?? MODELS.fast.id;
  const version = options.promptVersion ?? 'prompt_v1';

  if (options.stream) {
    return (async function* () {
      for await (const chunk of streamChat(messages, model, undefined, {
        merchantId: options.merchantId,
      })) {
        yield chunk;
      }
    })();
  }

  const result = await chat(messages, model, {
    merchantId: options.merchantId,
  });

  return {
    ...result,
    documents,
    messages,
    promptVersion: version,
  };
}
