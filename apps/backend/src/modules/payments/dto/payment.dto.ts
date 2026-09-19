import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreatePaymentOrderDto {
  @IsString({ message: 'amount 必须是字符串' })
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, {
    message: 'amount 必须是最多两位小数的人民币金额',
  })
  amount!: string;

  @IsIn(['ALIPAY', 'WECHAT'], { message: 'paymentMethod 不合法' })
  paymentMethod!: 'ALIPAY' | 'WECHAT';

  @IsIn(['WEB', 'H5', 'QR', 'JSAPI', 'APP'], { message: 'scene 不合法' })
  scene!: 'WEB' | 'H5' | 'QR' | 'JSAPI' | 'APP';

  @IsString({ message: 'channelId 必须是字符串' })
  @IsNotEmpty({ message: '请选择支付渠道' })
  channelId!: string;

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

  @IsOptional()
  @IsIn(['WEB', 'H5', 'QR', 'JSAPI', 'APP'], { message: 'scene 不合法' })
  scene?: 'WEB' | 'H5' | 'QR' | 'JSAPI' | 'APP';
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
