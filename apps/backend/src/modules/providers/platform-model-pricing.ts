import { BadRequestException } from '@nestjs/common';
import { ModelType } from '@prisma/client';

export type ChatModelPricing = {
  input: number;
  output: number;
};

export type ImageModelPricing = {
  perImage: number;
};

export type PlatformModelPricing = ChatModelPricing | ImageModelPricing;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

/**
 * Returns a client-facing validation message, or null when the pricing shape is valid.
 * Pricing is intentionally strict so the model type and the billing algorithm cannot drift apart.
 */
export function getPlatformModelPricingError(type: unknown, pricing: unknown): string | null {
  if (type !== ModelType.CHAT && type !== ModelType.IMAGE) {
    return 'type 不合法';
  }

  if (!isRecord(pricing)) {
    return 'pricing 必须是 JSON 对象';
  }

  if (type === ModelType.CHAT) {
    if (!hasOnlyKeys(pricing, ['input', 'output'])) {
      return '聊天模型计费必须包含 input 和 output，且不能包含其他字段';
    }
    if (!isValidPrice(pricing.input) || !isValidPrice(pricing.output)) {
      return '聊天模型 input 和 output 必须是大于等于 0 的有限数字';
    }
    return null;
  }

  if (!hasOnlyKeys(pricing, ['perImage'])) {
    return '生图模型计费必须只包含 perImage 字段';
  }
  if (!isValidPrice(pricing.perImage)) {
    return '生图模型 perImage 必须是大于等于 0 的有限数字';
  }

  return null;
}

export function assertValidPlatformModelPricing(
  type: ModelType,
  pricing: unknown,
): asserts pricing is PlatformModelPricing {
  const error = getPlatformModelPricingError(type, pricing);
  if (error) {
    throw new BadRequestException(error);
  }
}
