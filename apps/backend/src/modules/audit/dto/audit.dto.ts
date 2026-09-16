import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString({ message: 'userId 必须是字符串' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'action 必须是字符串' })
  action?: string;

  @IsOptional()
  @IsString({ message: 'resource 必须是字符串' })
  resource?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 必须大于 0' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于 0' })
  @Max(100, { message: 'limit 不能超过 100' })
  limit?: number;
}
