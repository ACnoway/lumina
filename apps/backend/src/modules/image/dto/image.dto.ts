import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// ==================== 提示词优化 DTO ====================

export class OptimizePromptDto {
  @ApiProperty({ description: '用户原始提示词', example: '一只猫' })
  @IsString({ message: '提示词必须是字符串' })
  @MaxLength(2000, { message: '提示词最多2000个字符' })
  prompt!: string;
}

// ==================== 生图任务 DTO ====================

export class CreateImageTaskDto {
  @ApiProperty({ description: '最终提示词（可能经过优化和编辑）', example: '一只可爱的白色猫娘...' })
  @IsString({ message: '提示词必须是字符串' })
  @MaxLength(4000, { message: '提示词最多4000个字符' })
  prompt!: string;

  @ApiProperty({ description: '用户原始输入（优化前）', required: false })
  @IsOptional()
  @IsString({ message: '原始提示词必须是字符串' })
  originalPrompt?: string;

  @ApiProperty({ description: '负面提示词', required: false })
  @IsOptional()
  @IsString({ message: '负面提示词必须是字符串' })
  negativePrompt?: string;

  @ApiProperty({ description: '平台模型名', example: 'dall-e-3' })
  @IsString({ message: '模型名必须是字符串' })
  model!: string;

  @ApiProperty({
    description: '图片比例',
    enum: ['1:1', '9:16', '16:9', '4:3', '3:4'],
    default: '1:1',
    required: false,
  })
  @IsOptional()
  @IsIn(['1:1', '9:16', '16:9', '4:3', '3:4'], { message: '比例不合法' })
  aspectRatio?: string;
}

// ==================== 分页查询 DTO ====================

export class GetImageHistoryQueryDto {
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
