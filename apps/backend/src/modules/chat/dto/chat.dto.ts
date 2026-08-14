import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
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
