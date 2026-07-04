export interface Merchant {
  id: string;
  shopDomain: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  updatedAt: string;
}

export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';

export interface Conversation {
  id: string;
  merchantId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  status: ConversationStatus;
  subject: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'customer' | 'agent' | 'ai' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export type OrderStatus =
  'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

export interface Order {
  id: string;
  merchantId: string;
  shopifyOrderId: string;
  orderNumber: string;
  customerEmail: string;
  status: OrderStatus;
  totalPrice: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export type PlanId = 'free' | 'starter' | 'pro' | 'enterprise';
