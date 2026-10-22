/**
 * 聊天页前端专用类型定义
 */

import type {
  ChatSessionDto,
  ChatMessageDto,
  ChatAttachmentDto,
  ChatModelPricing,
  MessageRole,
} from '@lumina/shared';

export type ChatSession = ChatSessionDto;

export type ChatMessage = ChatMessageDto;
export type ChatAttachment = ChatAttachmentDto;

export interface ChatModel {
  id: string;
  name: string;
  displayName: string;
  pricing: ChatModelPricing;
  supportsVision: boolean;
}

export interface BalanceInfo {
  balance: number;
  walletId: string;
}

/** SSE 流式事件 */
export type SSEEvent =
  | { type: 'accepted'; attachments: ChatAttachment[] }
  | { type: 'content'; content: string }
  | {
      type: 'done';
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      cost: number;
    }
  | { type: 'error'; message: string };

/** 本地临时消息（还没保存到后端时用） */
export interface TempMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
}
