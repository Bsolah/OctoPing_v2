export type AgentPresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export type WsClientRole = 'customer' | 'merchant' | 'agent';

export type WsClientMessageType =
  | 'join'
  | 'leave'
  | 'chat_message'
  | 'typing_start'
  | 'typing_stop'
  | 'presence_update'
  | 'ping';

export type WsServerMessageType =
  | 'joined'
  | 'left'
  | 'chat_message'
  | 'typing'
  | 'presence'
  | 'ai_token'
  | 'ai_done'
  | 'error'
  | 'pong';

export type WsClientMessage =
  | {
      type: 'join';
      room: string;
    }
  | {
      type: 'leave';
      room: string;
    }
  | {
      type: 'chat_message';
      conversationId: string;
      content: string;
      clientMessageId?: string;
    }
  | {
      type: 'typing_start' | 'typing_stop';
      conversationId: string;
    }
  | {
      type: 'presence_update';
      status: AgentPresenceStatus;
    }
  | {
      type: 'ping';
    };

export type WsServerMessage =
  | {
      type: 'joined';
      room: string;
    }
  | {
      type: 'left';
      room: string;
    }
  | {
      type: 'chat_message';
      conversationId: string;
      messageId: string;
      senderType: 'customer' | 'ai' | 'human' | 'system';
      content: string;
      createdAt: string;
    }
  | {
      type: 'typing';
      conversationId: string;
      actorId: string;
      isTyping: boolean;
    }
  | {
      type: 'presence';
      merchantId: string;
      agents: Array<{
        agentId: string;
        status: AgentPresenceStatus;
        lastSeen: string;
      }>;
    }
  | {
      type: 'ai_token';
      conversationId: string;
      token: string;
    }
  | {
      type: 'ai_done';
      conversationId: string;
      messageId: string;
      content: string;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    }
  | {
      type: 'pong';
    };
