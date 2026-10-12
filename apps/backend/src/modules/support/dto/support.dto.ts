import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupportConversationStatus } from '@prisma/client';

export class SendSupportMessageDto {
  @IsString({ message: '消息必须是字符串' })
  @MaxLength(2000, { message: '客服消息不能超过 2000 个字符' })
  content!: string;
}

export class SupportMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于 0' })
  @Max(1000000, { message: '页码过大' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于 0' })
  @Max(100, { message: '每页最多查询 100 条消息' })
  limit?: number;
}

export class SupportConversationsQueryDto extends SupportMessagesQueryDto {
  @IsOptional()
  @IsEnum(SupportConversationStatus, { message: '会话状态不合法' })
  status?: SupportConversationStatus;

  @IsOptional()
  @IsIn(['USER', 'ADMIN'], { message: '未读筛选不合法' })
  unread?: 'USER' | 'ADMIN';

  @IsOptional()
  @IsString({ message: '关键词必须是字符串' })
  @MaxLength(100, { message: '关键词不能超过 100 个字符' })
  keyword?: string;
}

export class UpdateSupportConversationStatusDto {
  @IsEnum(SupportConversationStatus, { message: '会话状态不合法' })
  status!: SupportConversationStatus;
}
