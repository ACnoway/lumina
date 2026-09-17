import { BadRequestException } from '@nestjs/common';

export type ProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  rateLimit?: number;
};

export type ProviderConfigPatch = Partial<ProviderConfig>;

const SUPPORTED_CONFIG_KEYS = new Set(['apiKey', 'baseUrl', 'timeout', 'rateLimit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function getProviderConfigError(
  config: unknown,
  options: { requireApiKey?: boolean } = {},
): string | null {
  const requireApiKey = options.requireApiKey ?? true;

  if (!isRecord(config)) {
    return '供应商配置必须是 JSON 对象';
  }

  const unsupportedKey = Object.keys(config).find((key) => !SUPPORTED_CONFIG_KEYS.has(key));
  if (unsupportedKey) {
    return `供应商配置包含不支持的字段：${unsupportedKey}`;
  }

  if (
    (requireApiKey || config.apiKey !== undefined) &&
    (typeof config.apiKey !== 'string' || !config.apiKey.trim())
  ) {
    return '供应商 API Key 不能为空';
  }

  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== 'string') {
      return '供应商 Base URL 必须是字符串';
    }
    if (config.baseUrl.trim()) {
      try {
        const url = new URL(config.baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error();
        }
      } catch {
        return '供应商 Base URL 必须是有效的 HTTP(S) 地址';
      }
    }
  }

  if (config.timeout !== undefined && !isPositiveInteger(config.timeout)) {
    return '供应商超时必须是大于 0 的整数（毫秒）';
  }

  if (config.rateLimit !== undefined && !isPositiveInteger(config.rateLimit)) {
    return '供应商限流必须是大于 0 的整数（次/分钟）';
  }

  return null;
}

export function assertValidProviderConfig(config: unknown): asserts config is ProviderConfig {
  const error = getProviderConfigError(config);
  if (error) {
    throw new BadRequestException(error);
  }
}

export function assertValidProviderConfigPatch(
  config: unknown,
): asserts config is ProviderConfigPatch {
  const error = getProviderConfigError(config, { requireApiKey: false });
  if (error) {
    throw new BadRequestException(error);
  }
}
