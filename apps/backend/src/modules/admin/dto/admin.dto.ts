import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { UserStatus } from '@prisma/client';

export class PaginationQueryDto {
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

export class ListAdminUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'search 必须是字符串' })
  @MaxLength(100, { message: 'search 不能超过 100 个字符' })
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'status 不合法' })
  status?: UserStatus;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus, { message: 'status 不合法' })
  status!: UserStatus;
}

export class AdjustUserBalanceDto {
  @IsString({ message: 'userId 必须是字符串' })
  @IsNotEmpty({ message: 'userId 不能为空' })
  userId!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'amount 必须是有限数字' })
  @NotEquals(0, { message: 'amount 不能为 0' })
  amount!: number;

  @IsString({ message: 'reason 必须是字符串' })
  @IsNotEmpty({ message: 'reason 不能为空' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason!: string;
}
