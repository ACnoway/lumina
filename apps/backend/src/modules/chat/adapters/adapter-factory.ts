import { Injectable, BadRequestException } from '@nestjs/common';
import { OpenAIAdapter } from './openai.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { IChatAdapter } from './types';

@Injectable()
export class AdapterFactory {
  /**
   * 根据 apiFormat 创建对应的适配器
   * @param apiFormat 供应商的 API 格式
   * @param config 供应商配置（apiKey, baseUrl, timeout 等）
   */
  createAdapter(
    apiFormat: string,
    config: Record<string, any>,
  ): IChatAdapter {
    switch (apiFormat) {
      case 'openai_chat':
      case 'openai_compatible':
        return new OpenAIAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          timeout: config.timeout,
        });

      case 'anthropic_messages':
        return new AnthropicAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          timeout: config.timeout,
        });

      case 'openai_image':
      case 'stability_image':
        throw new BadRequestException(
          `apiFormat "${apiFormat}" 是生图格式，不支持聊天调用`,
        );

      default:
        throw new BadRequestException(`不支持的 apiFormat: ${apiFormat}`);
    }
  }
}
