/**
 * 上游聊天适配器统一类型定义
 */

/** 单条消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 聊天请求参数 */
export interface ChatRequest {
  messages: ChatMessage[];
  model: string;          // 上游实际模型名
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;       // 是否流式
}

/** token 用量 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 非流式聊天响应 */
export interface ChatResponse {
  content: string;        // 回复内容
  inputTokens: number;    // 输入 token 数
  outputTokens: number;   // 输出 token 数
  totalTokens: number;    // 总 token 数
  model: string;          // 实际使用的模型
  finishReason?: string;  // 结束原因
}

/** 流式回调 */
export interface StreamCallbacks {
  onContent: (chunk: string) => void;       // 收到内容片段
  onDone?: (usage: TokenUsage) => void;     // 流结束，返回 token 用量
  onError?: (error: Error) => void;         // 出错
}

/** 适配器接口 */
export interface IChatAdapter {
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest, callbacks: StreamCallbacks): Promise<void>;
}
