import 'reflect-metadata';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const auditLog = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const service = new AuditService({ auditLog } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists the actor, action, target resource, and request context', async () => {
    const createdAt = new Date('2026-09-16T00:00:00.000Z');
    auditLog.create.mockResolvedValue({ id: 'audit-1', createdAt });

    await service.record({
      actorId: 'admin-1',
      action: 'user.status.updated',
      resource: 'user',
      details: { targetId: 'user-1', after: { status: 'SUSPENDED' } },
      ipAddress: '127.0.0.1',
      userAgent: 'Lumina test',
    });

    expect(auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'user.status.updated',
        resource: 'user',
        details: { targetId: 'user-1', after: { status: 'SUSPENDED' } },
        ipAddress: '127.0.0.1',
        userAgent: 'Lumina test',
      },
    });
  });

  it('returns newest audit logs with filters and pagination metadata', async () => {
    auditLog.findMany.mockResolvedValue([{ id: 'audit-1' }]);
    auditLog.count.mockResolvedValue(21);

    await expect(service.list({ page: 2, limit: 10, action: 'provider.updated' })).resolves.toEqual(
      {
        items: [{ id: 'audit-1' }],
        total: 21,
        page: 2,
        limit: 10,
        totalPages: 3,
      },
    );

    expect(auditLog.findMany).toHaveBeenCalledWith({
      where: { action: 'provider.updated' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
  });
});
