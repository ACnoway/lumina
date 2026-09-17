import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  IsIn,
  IsObject,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { ApiFormat, ModelType } from '@lumina/shared';
import { getPlatformModelPricingError } from '../platform-model-pricing';
import { getProviderConfigError } from '../provider-config';

// ==================== 供应商 DTO ====================
@ValidatorConstraint({ name: 'providerConfig', async: false })
export class ProviderConfigConstraint implements ValidatorConstraintInterface {
  validate(config: unknown): boolean {
    return getProviderConfigError(config) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return getProviderConfigError(args.value) || '供应商配置不合法';
  }
}

@ValidatorConstraint({ name: 'providerConfigPatch', async: false })
export class ProviderConfigPatchConstraint implements ValidatorConstraintInterface {
  validate(config: unknown): boolean {
    return getProviderConfigError(config, { requireApiKey: false }) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return getProviderConfigError(args.value, { requireApiKey: false }) || '供应商配置不合法';
  }
}

export class CreateProviderDto {
  @ApiProperty({ description: '供应商名称', example: 'openai' })
  @IsString({ message: '名称必须是字符串' })
  name!: string;

  @ApiProperty({
    description: 'API 格式',
    enum: ['openai_chat', 'openai_compatible', 'anthropic_messages', 'openai_image', 'stability_image'],
    example: 'openai_chat',
  })
  @IsIn(['openai_chat', 'openai_compatible', 'anthropic_messages', 'openai_image', 'stability_image'], {
    message: 'apiFormat 不合法',
  })
  apiFormat!: ApiFormat;

  @ApiProperty({ description: '是否支持流式', default: true, required: false })
  @IsOptional()
  @IsBoolean({ message: 'supportsStreaming 必须是布尔值' })
  supportsStreaming?: boolean;

  @ApiProperty({
    description: '配置信息（apiKey, baseUrl, timeout, rateLimit）',
    example: {
      apiKey: 'sk-xxx',
      baseUrl: 'https://api.openai.com/v1',
      timeout: 30000,
      rateLimit: 60,
    },
  })
  @IsObject({ message: 'config 必须是对象' })
  @Validate(ProviderConfigConstraint)
  config!: Record<string, any>;

  @ApiProperty({ description: '是否启用', default: true, required: false })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

export class UpdateProviderDto {
  @ApiProperty({ description: '供应商名称', required: false })
  @IsOptional()
  @IsString({ message: '名称必须是字符串' })
  name?: string;

  @ApiProperty({
    description: 'API 格式',
    enum: ['openai_chat', 'openai_compatible', 'anthropic_messages', 'openai_image', 'stability_image'],
    required: false,
  })
  @IsOptional()
  @IsIn(['openai_chat', 'openai_compatible', 'anthropic_messages', 'openai_image', 'stability_image'], {
    message: 'apiFormat 不合法',
  })
  apiFormat?: ApiFormat;

  @ApiProperty({ description: '是否支持流式', required: false })
  @IsOptional()
  @IsBoolean({ message: 'supportsStreaming 必须是布尔值' })
  supportsStreaming?: boolean;

  @ApiProperty({
    description: '配置信息；apiKey 可选，省略时保留原密钥',
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'config 必须是对象' })
  @Validate(ProviderConfigPatchConstraint)
  config?: Record<string, any>;

  @ApiProperty({ description: '是否启用', required: false })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

// ==================== 平台模型 DTO ====================
@ValidatorConstraint({ name: 'platformModelPricing', async: false })
export class PlatformModelPricingConstraint implements ValidatorConstraintInterface {
  validate(pricing: unknown, args: ValidationArguments): boolean {
    const type = (args.object as { type?: unknown }).type;

    // Update requests may change pricing without repeating the existing type. The
    // service validates the merged persisted model in that case.
    return type === undefined || getPlatformModelPricingError(type, pricing) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const type = (args.object as { type?: unknown }).type;
    return getPlatformModelPricingError(type, args.value) || '模型计费配置不合法';
  }
}

export class CreatePlatformModelDto {
  @ApiProperty({ description: '平台模型名', example: 'gpt-4o' })
  @IsString({ message: '名称必须是字符串' })
  name!: string;

  @ApiProperty({ description: '展示名', example: 'GPT-4o' })
  @IsString({ message: '展示名必须是字符串' })
  displayName!: string;

  @ApiProperty({ description: '模型类型', enum: ['CHAT', 'IMAGE'], example: 'CHAT' })
  @IsIn(['CHAT', 'IMAGE'], { message: 'type 不合法' })
  type!: ModelType;

  @ApiProperty({
    description:
      '计费标准：CHAT 使用 { input, output }（每千 token），IMAGE 使用 { perImage }（每张图片）',
    example: { input: 0.001, output: 0.002 },
  })
  @IsObject({ message: 'pricing 必须是对象' })
  @Validate(PlatformModelPricingConstraint)
  pricing!: Record<string, any>;

  @ApiProperty({ description: '平台限制的最大 token', required: false })
  @IsOptional()
  @IsInt({ message: 'maxTokens 必须是整数' })
  @Min(1, { message: 'maxTokens 必须大于0' })
  maxTokens?: number;

  @ApiProperty({ description: '是否启用', default: true, required: false })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

export class UpdatePlatformModelDto extends PartialType(CreatePlatformModelDto) {}

// ==================== 上游映射 DTO ====================
export class CreateUpstreamModelDto {
  @ApiProperty({ description: '供应商 ID' })
  @IsString({ message: '供应商 ID 必须是字符串' })
  providerId!: string;

  @ApiProperty({ description: '上游实际模型名', example: 'gpt-4o-2024-08-06' })
  @IsString({ message: '上游模型 ID 必须是字符串' })
  upstreamModelId!: string;

  @ApiProperty({ description: '优先级（数字越小越优先）', default: 1, required: false })
  @IsOptional()
  @IsInt({ message: 'priority 必须是整数' })
  @Min(0, { message: 'priority 不能为负数' })
  priority?: number;

  @ApiProperty({ description: '同优先级权重（加权随机）', default: 1, required: false })
  @IsOptional()
  @IsInt({ message: 'weight 必须是整数' })
  @Min(1, { message: 'weight 必须大于0' })
  weight?: number;

  @ApiProperty({ description: '是否启用', default: true, required: false })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;

  @ApiProperty({
    description: '上游成本',
    example: { input: 0.001, output: 0.002 },
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'upstreamPricing 必须是对象' })
  upstreamPricing?: Record<string, any>;

  @ApiProperty({ description: '上游限制（可选覆盖平台值）', required: false })
  @IsOptional()
  @IsInt({ message: 'maxTokens 必须是整数' })
  @Min(1, { message: 'maxTokens 必须大于0' })
  maxTokens?: number;
}

export class UpdateUpstreamModelDto extends PartialType(CreateUpstreamModelDto) {}
