import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// ==================== 会话 DTO ====================

export class CreateSessionDto {
  @ApiProperty({ description: '会话标题', default: '新对话', required: false })
  @IsOptional()
  @IsString({ message: '标题必须是字符串' })
  @MaxLength(100, { message: '标题最多100个字符' })
  title?: string;
}

export class UpdateSessionDto extends PartialType(CreateSessionDto) {}

// ==================== 分页查询 DTO ====================

export class GetSessionsQueryDto {
  @ApiProperty({ description: '页码', default: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于0' })
  page?: number = 1;

  @ApiProperty({ description: '每页条数', default: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数必须大于0' })
  limit?: number = 20;
}

export class GetMessagesQueryDto {
  @ApiProperty({ description: '页码', default: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于0' })
  page?: number = 1;

  @ApiProperty({ description: '每页条数', default: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数必须大于0' })
  limit?: number = 50;
}

// ==================== 发送消息 DTO ====================

export class SendMessageDto {
  @ApiProperty({ description: '会话 ID' })
  @IsString({ message: '会话 ID 必须是字符串' })
  sessionId!: string;

  @ApiProperty({ description: '消息内容' })
  @IsString({ message: '消息内容必须是字符串' })
  @MaxLength(10000, { message: '消息内容最多10000个字符' })
  content!: string;

  @ApiProperty({ description: '平台模型名', example: 'gpt-4o' })
  @IsString({ message: '模型名必须是字符串' })
  model!: string;

  @ApiProperty({ description: '温度', required: false, example: 0.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '温度必须是数字' })
  temperature?: number;

  @ApiProperty({ description: '最大输出 token', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxTokens 必须是整数' })
  @Min(1, { message: 'maxTokens 必须大于0' })
  maxTokens?: number;
}
