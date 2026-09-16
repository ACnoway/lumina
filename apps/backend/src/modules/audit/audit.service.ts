import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/audit.dto';

export interface CreateAuditLogInput {
  actorId: string;
  action: string;
  resource: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

type AuditLogWriter = Pick<PrismaService, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录管理员操作。传入 Prisma transaction client 时，日志会和调用方的业务变更同一事务提交。
   */
  async record(
    input: CreateAuditLogInput,
    writer: AuditLogWriter = this.prisma,
  ): Promise<AuditLog> {
    return writer.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        resource: input.resource,
        details: input.details
          ? (JSON.parse(JSON.stringify(input.details)) as Prisma.InputJsonValue)
          : undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async list(query: ListAuditLogsQueryDto): Promise<{
    items: AuditLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resource ? { resource: query.resource } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
