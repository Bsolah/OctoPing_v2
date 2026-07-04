export type {
  Merchant,
  Conversation,
  ConversationStatus,
  Message,
  MessageRole,
  Order,
  OrderStatus,
  PlanId,
} from './types';

export type {
  KnowledgeBaseEntry,
  SearchResult,
  PineconeVectorMetadata,
} from './types/pinecone';

export type {
  AgentPresenceStatus,
  WsClientRole,
  WsClientMessageType,
  WsServerMessageType,
  WsClientMessage,
  WsServerMessage,
} from './types/websocket';

export {
  CreateConversationSchema,
  SendMessageSchema,
  EscalateConversationSchema,
  ListConversationsSchema,
  AiQuerySchema,
  AiFeedbackSchema,
  AiSuggestSchema,
  UpdateMerchantSettingsSchema,
  CreateKnowledgeBaseSchema,
  AnalyticsQuerySchema,
  type CreateConversationInput,
  type SendMessageInput,
  type EscalateConversationInput,
  type ListConversationsInput,
  type AiQueryInput,
  type AiFeedbackInput,
  type UpdateMerchantSettingsInput,
  type CreateKnowledgeBaseInput,
} from './types/api';

export {
  SUPPORTED_LANGUAGES,
  AI_MODELS,
  PLANS,
  type SupportedLanguage,
  type AiModel,
  type Plan,
} from './constants';
