/**
 * 聊天相关 API 调用层
 */

import { apiClient } from './api-client';
import type {
  ChatSession,
  ChatMessage,
  ChatModel,
  BalanceInfo,
  SSEEvent,
} from './chat-types';

interface SessionsResponse {
  sessions: ChatSession[];
  total: number;
  page: number;
  limit: number;
}

interface MessagesResponse {
  messages: ChatMessageWire[];
  total: number;
  page: number;
  limit: number;
}

/** Prisma Decimal 等后端数值类型在 JSON 中可能以字符串形式返回。 */
type ChatMessageWire = Omit<ChatMessage, 'cost'> & {
  cost: number | string | null;
};

function normalizeChatMessage(message: ChatMessageWire): ChatMessage {
  return {
    ...message,
    cost: message.cost === null ? null : Number(message.cost),
  };
}

export const chatApi = {
  /** 创建会话 */
  createSession(title?: string): Promise<ChatSession> {
    return apiClient.post('/chat/sessions', title ? { title } : {});
  },

  /** 获取会话列表 */
  getSessions(page = 1, limit = 20): Promise<SessionsResponse> {
    return apiClient.get(`/chat/sessions?page=${page}&limit=${limit}`);
  },

  /** 更新会话标题 */
  updateSession(id: string, title: string): Promise<ChatSession> {
    return apiClient.patch(`/chat/sessions/${id}`, { title });
  },

  /** 删除会话 */
  deleteSession(id: string): Promise<void> {
    return apiClient.delete(`/chat/sessions/${id}`);
  },

  /** 获取会话历史消息 */
  async getMessages(
    sessionId: string,
    page = 1,
    limit = 50,
  ): Promise<Omit<MessagesResponse, 'messages'> & { messages: ChatMessage[] }> {
    const response = await apiClient.get<MessagesResponse>(
      `/chat/sessions/${sessionId}/messages?page=${page}&limit=${limit}`,
    );
    return {
      ...response,
      messages: response.messages.map(normalizeChatMessage),
    };
  },

  /** 获取可用聊天模型列表 */
  getChatModels(): Promise<ChatModel[]> {
    return apiClient.get('/providers/models?type=CHAT');
  },

  /** 获取余额 */
  getBalance(): Promise<BalanceInfo> {
    return apiClient.get('/wallet/balance');
  },

  /**
   * 发送消息（SSE 流式）
   * 返回 async generator，逐个 yield SSEEvent
   */
  async *sendMessageStream(
    sessionId: string,
    content: string,
    model: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<SSEEvent> {
    const res = await apiClient.stream('/chat/messages', {
      sessionId,
      content,
      model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `请求失败: ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行分割，最后一条可能不完整
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const json = trimmed.slice(6);
        if (!json) continue;

        try {
          yield JSON.parse(json) as SSEEvent;
        } catch {
          // JSON 解析失败，跳过
        }
      }
    }

    // 处理 buffer 中剩余数据
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const json = trimmed.slice(6);
      if (json) {
        try {
          yield JSON.parse(json) as SSEEvent;
        } catch {
          // 忽略
        }
      }
    }
  },
};
