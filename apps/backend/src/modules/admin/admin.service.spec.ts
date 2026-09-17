import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { SettingsService } from '../settings/settings.service';
import { AdminService } from './admin.service';

const admin = { id: 'admin-1' };
const user = {
  id: 'user-1',
  email: 'user@example.com',
  nickname: '测试用户',
  avatar: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
  wallet: { id: 'wallet-1', balance: new Decimal(12.5) },
};

function createService() {
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({ ...user, status: 'SUSPENDED' }),
    },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([user]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(user),
    },
    wallet: { aggregate: jest.fn().mockResolvedValue({ _sum: { balance: new Decimal(12.5) } }) },
    platformModel: {
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn(),
    },
    provider: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const wallet = {
    getTransactions: jest.fn(),
    adminAdjust: jest.fn().mockResolvedValue({
      id: 'transaction-1',
      type: 'ADMIN_ADJUST',
      amount: new Decimal(5),
      balance: new Decimal(17.5),
      reason: '补偿',
      createdAt: new Date('2026-09-16T00:00:00.000Z'),
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    getPromptOptimizerModel: jest.fn().mockResolvedValue(null),
    setPromptOptimizerModel: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new AdminService(
      prisma as unknown as PrismaService,
      wallet as unknown as WalletService,
      audit as unknown as AuditService,
      settings as unknown as SettingsService,
    ),
    prisma,
    wallet,
    audit,
    settings,
    tx,
  };
}

describe('AdminService', () => {
  it('lists user data without selecting credentials and serializes wallet balances', async () => {
    const { service, prisma } = createService();

    await expect(service.listUsers({ page: 1, limit: 20 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'user-1',
          email: 'user@example.com',
          wallet: { id: 'wallet-1', balance: 12.5 },
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ password: true }),
      }),
    );
  });

  it('changes user status and writes its before/after audit log in the same transaction', async () => {
    const { service, audit, tx } = createService();

    await service.updateUserStatus(
      admin as never,
      'user-1',
      { status: 'SUSPENDED' as never },
      { ipAddress: '127.0.0.1' },
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'user.status.updated',
        resource: 'user',
        details: {
          targetId: 'user-1',
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED' },
        },
      }),
      tx,
    );
  });

  it('passes the acting administrator and request context to a wallet adjustment', async () => {
    const { service, wallet } = createService();

    await expect(
      service.adjustUserBalance(
        admin as never,
        { userId: 'user-1', amount: 5, reason: '补偿' },
        { ipAddress: '127.0.0.1', userAgent: 'Lumina test' },
      ),
    ).resolves.toEqual({
      id: 'transaction-1',
      type: 'ADMIN_ADJUST',
      amount: 5,
      balance: 17.5,
      reason: '补偿',
      createdAt: '2026-09-16T00:00:00.000Z',
    });

    expect(wallet.adminAdjust).toHaveBeenCalledWith('user-1', 5, '补偿', {
      actorId: 'admin-1',
      ipAddress: '127.0.0.1',
      userAgent: 'Lumina test',
    });
  });

  it('only allows an active chat model with an active chat-compatible upstream', async () => {
    const { service, prisma, settings, audit } = createService();
    prisma.platformModel.findUnique.mockResolvedValue({
      id: 'chat-model-1',
      name: 'chat-model',
      type: 'CHAT',
      isActive: true,
      upstreamModels: [
        {
          isActive: true,
          provider: { isActive: true, apiFormat: 'openai_compatible' },
        },
      ],
    });

    await expect(
      service.updatePromptOptimizerSetting(
        admin as never,
        { modelId: 'chat-model-1' },
        { ipAddress: '127.0.0.1' },
      ),
    ).resolves.toEqual({ modelId: 'chat-model-1', modelName: 'chat-model' });
    expect(settings.setPromptOptimizerModel).toHaveBeenCalledWith('chat-model-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'prompt_optimizer_model.updated',
        resource: 'system_config',
      }),
    );
  });

  it('rejects an image model as the prompt optimizer', async () => {
    const { service, prisma } = createService();
    prisma.platformModel.findUnique.mockResolvedValue({
      id: 'image-model-1',
      name: 'image-model',
      type: 'IMAGE',
      isActive: true,
      upstreamModels: [],
    });

    await expect(
      service.updatePromptOptimizerSetting(
        admin as never,
        { modelId: 'image-model-1' },
        {},
      ),
    ).rejects.toThrow('提示词优化只能使用聊天模型');
  });
});
