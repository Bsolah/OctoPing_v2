export type WidgetPosition = 'bottom-right' | 'bottom-left';

export type WidgetConfig = {
  merchantId: string;
  apiUrl: string;
  token: string;
  title: string;
  greeting: string;
  primaryColor: string;
  position: WidgetPosition;
  logoUrl?: string;
  suggestedReplies: string[];
  proactiveDelayMs: number;
};

export type ChatMessageKind =
  'text' | 'product' | 'tracking' | 'order_lookup' | 'system';

export type ProductCardData = {
  title: string;
  price?: string;
  imageUrl?: string;
  url?: string;
  productId?: string;
};

export type TrackingCardData = {
  carrier?: string;
  status?: string;
  trackingNumber?: string;
  timeline?: Array<{
    description: string;
    timestamp?: string;
    location?: string;
  }>;
};

export type WidgetMessage = {
  id: string;
  role: 'customer' | 'ai' | 'human' | 'system';
  kind: ChatMessageKind;
  content: string;
  createdAt: string;
  status?: 'sending' | 'sent' | 'error';
  product?: ProductCardData;
  tracking?: TrackingCardData;
};

export type WidgetState = {
  open: boolean;
  conversationId: string | null;
  messages: WidgetMessage[];
  connected: boolean;
  typing: boolean;
  error: string | null;
};
