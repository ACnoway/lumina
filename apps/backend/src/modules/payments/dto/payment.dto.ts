import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentOrderDto {
  @IsString({ message: 'amount 必须是字符串' })
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, {
    message: 'amount 必须是最多两位小数的人民币金额',
  })
  amount!: string;

  @IsIn(['ALIPAY', 'WECHAT'], { message: 'paymentMethod 不合法' })
  paymentMethod!: 'ALIPAY' | 'WECHAT';

  @IsOptional()
  @IsString({ message: 'subject 必须是字符串' })
  @MaxLength(128, { message: 'subject 不能超过 128 个字符' })
  subject?: string;

  @IsOptional()
  @IsString({ message: 'payerOpenId 必须是字符串' })
  @MaxLength(128, { message: 'payerOpenId 不能超过 128 个字符' })
  payerOpenId?: string;
}

export class ListPaymentChannelsQueryDto {
  @IsOptional()
  @IsIn(['ALIPAY', 'WECHAT'], { message: 'paymentMethod 不合法' })
  paymentMethod?: 'ALIPAY' | 'WECHAT';
}

export class ListPaymentOrdersQueryDto {
  @IsOptional()
  @IsIn(['CREATED', 'PENDING'], { message: 'status 只能为 CREATED 或 PENDING' })
  status?: 'CREATED' | 'PENDING';

  @IsOptional()
  @IsIn(['createdAt', 'expireAt'], { message: 'sortBy 只能为 createdAt 或 expireAt' })
  sortBy?: 'createdAt' | 'expireAt' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder 只能为 asc 或 desc' })
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 必须大于 0' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于 0' })
  @Max(100, { message: 'limit 不能超过 100' })
  limit?: number = 20;
}

export class CreatePaymentChannelDto {
  @IsString({ message: 'name 必须是字符串' })
  @IsNotEmpty({ message: 'name 不能为空' })
  @MaxLength(100, { message: 'name 不能超过 100 个字符' })
  name!: string;

  @IsIn(['EPAY', 'ALIPAY', 'WECHAT'], { message: 'type 不合法' })
  type!: 'EPAY' | 'ALIPAY' | 'WECHAT';

  @IsObject({ message: 'config 必须是对象' })
  config!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

export class UpdatePaymentChannelDto {
  @IsOptional()
  @IsString({ message: 'name 必须是字符串' })
  @IsNotEmpty({ message: 'name 不能为空' })
  @MaxLength(100, { message: 'name 不能超过 100 个字符' })
  name?: string;

  @IsOptional()
  @IsObject({ message: 'config 必须是对象' })
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

export class PaymentOrderParamDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;
}
