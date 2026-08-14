import { Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Readable } from 'stream';
import {
  ChatRequest,
  ChatResponse,
  StreamCallbacks,
  IChatAdapter,
  TokenUsage,
} from './types';

export class OpenAIAdapter implements IChatAdapter {
  private readonly logger = new Logger(OpenAIAdapter.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: Record<string, any>) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl as string)?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
    this.timeout = config.timeout ?? 30000;

    if (!this.apiKey) {
      throw new BadRequestException('OpenAI 适配器缺少 apiKey');
    }
    if (!this.baseUrl) {
      throw new BadRequestException('OpenAI 适配器缺少 baseUrl');
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    try {
      const response = await axios.post(
        url,
        {
          model: request.model,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      );

      const data = response.data;
      const choice = data.choices?.[0];

      if (!choice) {
        throw new ServiceUnavailableException('上游返回了空的 choices');
      }

      const usage = data.usage || {};

      return {
        content: choice.message?.content || '',
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        model: data.model || request.model,
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async chatStream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const url = `${this.baseUrl}/chat/completions`;

    try {
      const response = await axios.post(
        url,
        {
          model: request.model,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
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

          // 按行分割，处理完整的行
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 最后一行可能不完整，留在 buffer 里

          for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed || !trimmed.startsWith('data:')) {
              continue;
            }

            const jsonStr = trimmed.slice(5).trim(); // 去掉 "data:" 前缀

            if (jsonStr === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(jsonStr);
              const choice = parsed.choices?.[0];

              if (choice?.delta?.content) {
                callbacks.onContent(choice.delta.content);
              }

              // usage 通常在最后一个 chunk
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens || inputTokens;
                outputTokens = parsed.usage.completion_tokens || outputTokens;
              }
            } catch {
              // JSON 解析失败，跳过这一行（可能是部分 chunk）
            }
          }
        });

        stream.on('end', () => {
          // 处理 buffer 中剩余的数据
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens || inputTokens;
                  outputTokens = parsed.usage.completion_tokens || outputTokens;
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
        this.logger.error(`OpenAI 请求超时: ${axiosError.message}`);
        return new ServiceUnavailableException('上游请求超时，请稍后重试');
      }

      const status = axiosError.response?.status;
      const msg =
        (axiosError.response?.data as any)?.error?.message ||
        axiosError.message;

      this.logger.error(`OpenAI 请求失败: status=${status}, message=${msg}`);

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
      this.logger.error(`OpenAI 适配器错误: ${error.message}`, error.stack);
      return error;
    }

    return new ServiceUnavailableException('未知错误');
  }
}
