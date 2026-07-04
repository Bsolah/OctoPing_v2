export {
  chat,
  streamChat,
  getMerchantCost,
  resetMerchantCost,
  getCircuitBreakerState,
} from './llm/client';
export {
  MODELS,
  CONTEXT_BUDGET,
  EMBEDDING_DIMENSIONS,
  calculateCostUsd,
  getChatModelConfig,
  type ChatModelId,
  type EmbeddingModelId,
  type ModelConfig,
} from './llm/models';
export type {
  ChatMessage,
  ChatResult,
  StreamChunk,
  TokenUsage,
  ToolDefinition,
} from './llm/types';

export {
  generateEmbedding,
  generateBatchEmbeddings,
  chunkText,
  countTokens,
  embedDocument,
  type TextChunk,
} from './embeddings/generator';

export {
  retrieveContext,
  retrieveProductContext,
  retrievePolicyContext,
  type RetrievedDocument,
} from './rag/retriever';

export {
  buildCustomerContext,
  buildSystemPrompt,
  formatContextForLLM,
  type CustomerContextStore,
  type CustomerContext,
  type MerchantPromptConfig,
} from './rag/context-builder';

export { getSystemPrompt, SYSTEM_PROMPTS } from './prompts/system';
export { getPreSalePrompt, PRE_SALE_PROMPTS } from './prompts/pre-sale';
export { getWismoPrompt, WISMO_PROMPTS } from './prompts/wismo';
export type { PromptVersion, VersionedPrompt } from './prompts/types';

export { answerProductQuestion } from './pipeline/answer';

export {
  IntentType,
  SentimentType,
  CONFIDENCE_THRESHOLD,
  supervisorNode,
  routeIntent,
  preSaleAgentNode,
  wismoAgentNode,
  returnsAgentNode,
  technicalAgentNode,
  escalationAgentNode,
  setEscalationNotifier,
  smallTalkAgentNode,
  responseFormatterNode,
  createAgentTools,
  getAgentGraph,
  runAgentGraph,
  processAgentTurn,
  connectAgentStateStore,
  disconnectAgentStateStore,
  loadAgentState,
  saveAgentState,
  createInitialState,
  type AgentState,
  type AgentMessage,
  type AgentAction,
  type SpecialistOutput,
  type EscalationPackage,
  type ProcessAgentTurnInput,
} from './agents';
