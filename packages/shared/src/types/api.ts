import { z } from 'zod';

export const CreateConversationSchema = z.object({
  channel: z.enum([
    'widget',
    'shopify_inbox',
    'sms',
    'whatsapp',
    'email',
    'instagram',
  ]),
  customerEmail: z.string().email().optional(),
  customerShopifyId: z.string().optional(),
  initialMessage: z.string().min(1).optional(),
  visitorId: z.string().min(1).max(200).optional(),
  cartProductIds: z.array(z.string()).max(100).optional(),
  cartValueAtStart: z.number().nonnegative().optional(),
});

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  stream: z.boolean().optional().default(true),
});

export const EscalateConversationSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
});

export const ListConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'resolved', 'escalated', 'closed']).optional(),
  q: z.string().optional(),
});

export const AiQuerySchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  stream: z.boolean().optional().default(false),
});

export const AiFeedbackSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  comment: z.string().max(2000).optional(),
});

export const AiSuggestSchema = z.object({
  conversationId: z.string().uuid(),
  draft: z.string().max(2000).optional(),
});

export const UpdateMerchantSettingsSchema = z.object({
  aiTone: z.string().min(1).max(100).optional(),
  escalationThreshold: z.number().min(0).max(1).optional(),
  rules: z.array(z.string()).optional(),
  widgetConfig: z.record(z.unknown()).optional(),
});

export const CreateKnowledgeBaseSchema = z.object({
  contentType: z.enum(['faq', 'policy', 'product', 'shipping']),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const AnalyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(['active', 'resolved', 'escalated', 'closed']).optional(),
});

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type EscalateConversationInput = z.infer<
  typeof EscalateConversationSchema
>;
export type ListConversationsInput = z.infer<typeof ListConversationsSchema>;
export type AiQueryInput = z.infer<typeof AiQuerySchema>;
export type AiFeedbackInput = z.infer<typeof AiFeedbackSchema>;
export type UpdateMerchantSettingsInput = z.infer<
  typeof UpdateMerchantSettingsSchema
>;
export type CreateKnowledgeBaseInput = z.infer<
  typeof CreateKnowledgeBaseSchema
>;
