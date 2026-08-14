import { Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Readable } from 'stream';
import {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  StreamCallbacks,
  IChatAdapter,
  TokenUsage,
} from './types';

export class AnthropicAdapter implements IChatAdapter {
  private readonly logger = new Logger(AnthropicAdapter.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: Record<string, any>) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl as string)?.replace(/\/+$/, '') || 'https://api.anthropic.com/v1';
    this.timeout = config.timeout ?? 30000;

    if (!this.apiKey) {
      throw new BadRequestException('Anthropic 适配器缺少 apiKey');
    }
    if (!this.baseUrl) {
      throw new BadRequestException('Anthropic 适配器缺少 baseUrl');
    }
  }

  /**
   * 将 OpenAI 风格的 messages 转换为 Anthropic 格式
   * Anthropic 把 system 消息放在顶层字段，不在 messages 数组里
   */
  private transformMessages(
    messages: ChatMessage[],
  ): { system: string | undefined; messages: Array<{ role: string; content: string }> } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const system = systemMessages.map((m) => m.content).join('\n') || undefined;

    return {
      system,
      messages: chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/messages`;
    const { system, messages } = this.transformMessages(request.messages);

    try {
      const response = await axios.post(
        url,
        {
          model: request.model,
          messages,
          system,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: false,
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      );

      const data = response.data;

      // Anthropic 响应: content 是数组，取第一个 text 类型的 block
      const textBlock = data.content?.find(
        (block: any) => block.type === 'text',
      );

      const usage = data.usage || {};

      return {
        content: textBlock?.text || '',
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        model: data.model || request.model,
        finishReason: data.stop_reason,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async chatStream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const url = `${this.baseUrl}/messages`;
    const { system, messages } = this.transformMessages(request.messages);

    try {
      const response = await axios.post(
        url,
        {
          model: request.model,
          messages,
          system,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: true,
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
          responseType: 'stream',
        },
      );

      const stream = response.data as Readable;
      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // SSE 格式：事件之间用空行分隔
          // 每个事件由 event: xxx 和 data: {...} 组成
          const events = buffer.split('\n\n');
          buffer = events.pop() || ''; // 最后一个可能不完整

          for (const eventBlock of events) {
            const lines = eventBlock.split('\n');
            let eventType = '';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataStr = line.slice(5).trim();
              }
            }

            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);

              switch (parsed.type || eventType) {
                case 'message_start':
                  inputTokens = parsed.message?.usage?.input_tokens || 0;
                  break;

                case 'content_block_delta':
                  if (parsed.delta?.type === 'text_delta') {
                    callbacks.onContent(parsed.delta.text);
                  }
                  break;

                case 'message_delta':
                  outputTokens = parsed.usage?.output_tokens || outputTokens;
                  break;

                case 'message_stop':
                  // 流结束
                  break;
              }
            } catch {
              // JSON 解析失败，跳过
            }
          }
        });

        stream.on('end', () => {
          // 处理 buffer 中剩余数据
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('data:')) {
                dataStr = line.slice(5).trim();
              }
            }
            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
                  outputTokens = parsed.usage.output_tokens;
                }
              } catch {
                // 忽略
              }
            }
          }

          const usage: TokenUsage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };

          callbacks.onDone?.(usage);
          resolve();
        });

        stream.on('error', (err: Error) => {
          callbacks.onError?.(err);
          reject(err);
        });
      });
    } catch (error) {
      const wrapped = this.handleError(error);
      callbacks.onError?.(wrapped);
      throw wrapped;
    }
  }

  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        this.logger.error(`Anthropic 请求超时: ${axiosError.message}`);
        return new ServiceUnavailableException('上游请求超时，请稍后重试');
      }

      const status = axiosError.response?.status;
      const msg =
        (axiosError.response?.data as any)?.error?.message ||
        axiosError.message;

      this.logger.error(`Anthropic 请求失败: status=${status}, message=${msg}`);

      if (status === 401) {
        return new ServiceUnavailableException('上游 API Key 无效');
      }
      if (status === 429) {
        return new ServiceUnavailableException('上游限流，请稍后重试');
      }
      if (status && status >= 500) {
        return new ServiceUnavailableException(`上游服务异常 (${status})`);
      }

      return new BadRequestException(`上游返回错误: ${msg}`);
    }

    if (error instanceof Error) {
      this.logger.error(`Anthropic 适配器错误: ${error.message}`, error.stack);
      return error;
    }

    return new ServiceUnavailableException('未知错误');
  }
}
