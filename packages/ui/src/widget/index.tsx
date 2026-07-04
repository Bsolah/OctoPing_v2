/**
 * Widget package entry for app imports and the standalone embed build.
 */
export { ChatWidget } from './ChatWidget';
export { MessageBubble } from './MessageBubble';
export { useConversation } from './hooks/useConversation';
export { useWidgetConfig } from './hooks/useWidgetConfig';
export {
  mountNovaWidget,
  unmountNovaWidget,
  type NovaWidgetMountOptions,
} from './entry';
export type {
  WidgetConfig,
  WidgetMessage,
  WidgetPosition,
  ProductCardData,
  TrackingCardData,
} from './types';
