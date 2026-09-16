import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuditLogsResponse } from '@lumina/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListAuditLogsQueryDto } from './dto/audit.dto';
import { AuditService } from './audit.service';

@ApiTags('admin')
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: '分页查询管理员审计日志' })
  async list(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogsResponse> {
    const result = await this.auditService.list(query);

    return {
      ...result,
      items: result.items.map((item) => ({
        id: item.id,
        userId: item.userId,
        action: item.action,
        resource: item.resource,
        details:
          item.details && typeof item.details === 'object' && !Array.isArray(item.details)
            ? (item.details as Record<string, unknown>)
            : null,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}
