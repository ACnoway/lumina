import type {
  SupportConversationDto,
  SupportConversationsResponse,
  SupportConversationStatus,
  SupportMessageDto,
  SupportMessagesResponse,
  SupportSseEvent,
  SupportUnreadResponse,
} from '@lumina/shared';
import { apiClient } from './api-client';

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}

async function* parseSse(
  path: string,
  signal?: AbortSignal,
): AsyncGenerator<SupportSseEvent> {
  const response = await apiClient.streamGet(path, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `实时连接失败: ${response.status}`);
  }
  if (!response.body) throw new Error('实时连接没有返回数据流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readLine = (line: string): SupportSseEvent | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) return null;
    const json = trimmed.slice(6);
    if (!json) return null;
    if (json === '{"type":"ready"}') return { type: 'ready' };
    try {
      return JSON.parse(json) as SupportSseEvent;
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const event = readLine(line);
      if (event) yield event;
    }
  }

  const event = readLine(buffer);
  if (event) yield event;

  // A healthy SSE response is expected to stay open. Treat an unexpected
  // EOF as a connection failure so callers can enter their reconnect path
  // instead of spinning a new connection without backoff.
  throw new Error('实时连接已断开');
}

export const supportApi = {
  getConversation(): Promise<{ conversation: SupportConversationDto }> {
    return apiClient.get('/support/conversation');
  },

  getMessages(page = 1, limit = 50): Promise<SupportMessagesResponse> {
    return apiClient.get(`/support/conversation/messages${queryString({ page, limit })}`);
  },

  sendMessage(content: string): Promise<{
    message: SupportMessageDto;
    conversation: SupportConversationDto;
  }> {
    return apiClient.post('/support/conversation/messages', { content });
  },

  markRead(): Promise<{ conversation: SupportConversationDto }> {
    return apiClient.post('/support/conversation/read');
  },

  events(signal?: AbortSignal): AsyncGenerator<SupportSseEvent> {
    return parseSse('/support/conversation/events', signal);
  },

  listConversations(options: {
    page?: number;
    limit?: number;
    status?: SupportConversationStatus | '';
    unread?: 'USER' | 'ADMIN' | '';
    keyword?: string;
  } = {}): Promise<SupportConversationsResponse> {
    return apiClient.get(
      `/support/admin/conversations${queryString({
        page: options.page ?? 1,
        limit: options.limit ?? 20,
        status: options.status,
        unread: options.unread,
        keyword: options.keyword,
      })}`,
    );
  },

  getUnreadCount(): Promise<SupportUnreadResponse> {
    return apiClient.get('/support/admin/unread-count');
  },

  getAdminMessages(conversationId: string, page = 1, limit = 100): Promise<SupportMessagesResponse> {
    return apiClient.get(
      `/support/admin/conversations/${encodeURIComponent(conversationId)}/messages${queryString({ page, limit })}`,
    );
  },

  sendAdminMessage(conversationId: string, content: string): Promise<{
    message: SupportMessageDto;
    conversation: SupportConversationDto;
  }> {
    return apiClient.post(
      `/support/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content },
    );
  },

  markAdminRead(conversationId: string): Promise<{ conversation: SupportConversationDto }> {
    return apiClient.post(
      `/support/admin/conversations/${encodeURIComponent(conversationId)}/read`,
    );
  },

  updateStatus(
    conversationId: string,
    status: SupportConversationStatus,
  ): Promise<{ conversation: SupportConversationDto }> {
    return apiClient.patch(
      `/support/admin/conversations/${encodeURIComponent(conversationId)}/status`,
      { status },
    );
  },

  adminEvents(signal?: AbortSignal): AsyncGenerator<SupportSseEvent> {
    return parseSse('/support/admin/events', signal);
  },
};
