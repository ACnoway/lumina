import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from './wallet.service';

class InMemoryRedis {
  private readonly values = new Map<string, string>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly locks = new Map<string, string>();
  setPreDeductCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) || null;
  }

  async setNX(key: string, token: string): Promise<boolean> {
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, token);
    return true;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    if (this.locks.get(key) !== token) {
      return false;
    }
    this.locks.delete(key);
    return true;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) || new Map());
  }

  async setPreDeduct(
    redisKey: string,
    indexKey: string,
    field: string,
    value: string,
  ): Promise<void> {
    this.setPreDeductCalls += 1;
    this.values.set(redisKey, value);
    const index = this.hashes.get(indexKey) || new Map<string, string>();
    index.set(field, value);
    this.hashes.set(indexKey, index);
  }

  async removePreDeduct(
    redisKey: string,
    indexKey: string,
    field: string,
  ): Promise<void> {
    this.values.delete(redisKey);
    this.hashes.get(indexKey)?.delete(field);
  }
}

function createTestStore() {
  const wallet = {
    id: 'wallet-1',
    userId: 'user-1',
    balance: new Decimal(10),
  };
  const transactions: Array<{
    id: string;
    walletId: string;
    balance: Decimal;
    idempotencyKey: string | null;
  }> = [];
  let transactionId = 0;

  const prisma = {
    wallet: {
      findUnique: jest.fn(async () => wallet),
      update: jest.fn(async () => wallet),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    walletTransaction: {
      findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        transactions.find((item) => item.idempotencyKey === where.idempotencyKey) || null,
      ),
      create: jest.fn(async ({ data }: { data: { walletId: string; balance: Decimal; idempotencyKey: string } }) => {
        const transaction = {
          id: `transaction-${++transactionId}`,
          walletId: data.walletId,
          balance: data.balance,
          idempotencyKey: data.idempotencyKey,
        };
        transactions.push(transaction);
        return transaction;
      }),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        wallet: {
          findUnique: jest.fn(async () => wallet),
          update: jest.fn(async ({ data }: { data: { balance: Decimal } }) => {
            wallet.balance = data.balance;
            return wallet;
          }),
          updateMany: jest.fn(async ({ where, data }: {
            where: { balance: { gte: Decimal } };
            data: { balance: { decrement: Decimal } };
          }) => {
            if (wallet.balance.lessThan(where.balance.gte)) {
              return { count: 0 };
            }
            wallet.balance = wallet.balance.minus(data.balance.decrement);
            return { count: 1 };
          }),
        },
        walletTransaction: {
          create: jest.fn(async ({ data }: { data: { walletId: string; balance: Decimal; idempotencyKey: string } }) => {
            const transaction = {
              id: `transaction-${++transactionId}`,
              walletId: data.walletId,
              balance: data.balance,
              idempotencyKey: data.idempotencyKey,
            };
            transactions.push(transaction);
            return transaction;
          }),
        },
      }),
    ),
  };

  return { prisma, redis: new InMemoryRedis(), wallet, transactions };
}

function createWalletService(store: ReturnType<typeof createTestStore>) {
  return new WalletService(
    store.prisma as unknown as PrismaService,
    store.redis as unknown as RedisService,
    { record: jest.fn() } as unknown as AuditService,
  );
}

describe('WalletService reservations', () => {
  it('only creates one reservation for 100 concurrent calls with the same key', async () => {
    const store = createTestStore();
    const service = createWalletService(store);

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        service.preDeduct('user-1', 1, 'same-request'),
      ),
    );

    expect(results).toHaveLength(100);
    expect(results.filter((result) => result.message === '预扣成功')).toHaveLength(1);
    expect(store.redis.setPreDeductCalls).toBe(1);
  });

  it('never reserves more than the wallet balance across different concurrent keys', async () => {
    const store = createTestStore();
    const service = createWalletService(store);

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        service.preDeduct('user-1', 1, `request-${index}`),
      ),
    );

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful).toHaveLength(10);
    expect(rejected).toHaveLength(90);
    expect(store.wallet.balance.toNumber()).toBe(10);
  });

  it('does not charge twice when settle is retried concurrently', async () => {
    const store = createTestStore();
    const service = createWalletService(store);

    await service.preDeduct('user-1', 2, 'settle-request');
    const results = await Promise.all([
      service.settle('user-1', 1, 'settle-request', 'test'),
      service.settle('user-1', 1, 'settle-request', 'test'),
    ]);

    expect(results[0].transaction?.id).toBe(results[1].transaction?.id);
    expect(store.transactions).toHaveLength(1);
    expect(store.wallet.balance.toNumber()).toBe(9);
  });

  it('makes refund retries idempotent without changing the balance', async () => {
    const store = createTestStore();
    const service = createWalletService(store);

    await service.preDeduct('user-1', 2, 'refund-request');
    const first = await service.refund('user-1', 'refund-request', 'test');
    const second = await service.refund('user-1', 'refund-request', 'test');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(store.wallet.balance.toNumber()).toBe(10);
    expect(store.redis.setPreDeductCalls).toBe(1);
  });

  it('writes an administrator balance adjustment audit record in the wallet transaction', async () => {
    const store = createTestStore();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new WalletService(
      store.prisma as unknown as PrismaService,
      store.redis as unknown as RedisService,
      audit as unknown as AuditService,
    );

    await service.adminAdjust('user-1', 3, '补偿', {
      actorId: 'admin-1',
      ipAddress: '127.0.0.1',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'wallet.balance.adjusted',
        resource: 'wallet',
        details: expect.objectContaining({
          targetId: 'user-1',
          amount: 3,
          reason: '补偿',
          before: { balance: 10 },
          after: { balance: 13 },
        }),
        ipAddress: '127.0.0.1',
      }),
      expect.anything(),
    );
  });

  it('converts model names in user-visible transactions without changing admin data', async () => {
    const transaction = {
      id: 'transaction-1',
      walletId: 'wallet-1',
      type: 'CONSUME',
      amount: new Decimal('0.5'),
      balance: new Decimal('9.5'),
      reason: '聊天: internal-chat-model',
      metadata: {
        model: 'internal-chat-model',
        sessionId: 'session-1',
      },
      idempotencyKey: 'chat:session-1:message-1',
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
    };
    const prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', userId: 'user-1' }),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([transaction]),
        count: jest.fn().mockResolvedValue(1),
      },
      platformModel: {
        findMany: jest.fn().mockResolvedValue([
          { name: 'internal-chat-model', displayName: '用户聊天模型' },
        ]),
      },
    };
    const service = new WalletService(
      prisma as unknown as PrismaService,
      {} as RedisService,
      {} as AuditService,
    );

    const result = await service.getUserTransactions('user-1');

    expect(result.transactions[0]).toEqual({
      ...transaction,
      reason: '聊天: 用户聊天模型',
      metadata: {
        model: '用户聊天模型',
        sessionId: 'session-1',
      },
    });
    expect(prisma.platformModel.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['internal-chat-model'] } },
      select: { name: true, displayName: true },
    });
  });

  it('returns detailed chat token usage with the user-facing model name', async () => {
    const transaction = {
      id: 'transaction-chat',
      walletId: 'wallet-1',
      type: 'CONSUME',
      amount: new Decimal('0.5'),
      balance: new Decimal('9.5'),
      reason: '聊天: internal-chat-model',
      metadata: {
        model: 'internal-chat-model',
        sessionId: 'session-1',
        messageId: 'message-1',
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
      },
      idempotencyKey: 'chat:session-1:message-1',
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
    } as any;
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', userId: 'user-1' }) },
      walletTransaction: { findFirst: jest.fn().mockResolvedValue(transaction) },
      platformModel: {
        findMany: jest.fn().mockResolvedValue([
          { name: 'internal-chat-model', displayName: '用户聊天模型' },
        ]),
      },
    };
    const service = new WalletService(
      prisma as unknown as PrismaService,
      {} as RedisService,
      {} as AuditService,
    );

    await expect(service.getUserTransactionDetail('user-1', transaction.id)).resolves.toEqual({
      id: transaction.id,
      type: 'CONSUME',
      amount: 0.5,
      balance: 9.5,
      reason: '聊天: 用户聊天模型',
      createdAt: transaction.createdAt.toISOString(),
      kind: 'CHAT',
      model: '用户聊天模型',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      sessionId: 'session-1',
      messageId: 'message-1',
    });
  });

  it('resolves legacy recharge details from the payment order snapshot', async () => {
    const transaction = {
      id: 'transaction-recharge',
      walletId: 'wallet-1',
      type: 'RECHARGE',
      amount: new Decimal('100'),
      balance: new Decimal('110'),
      reason: '支付充值 LM2026092800001',
      metadata: null,
      idempotencyKey: 'payment:recharge:LM2026092800001',
      createdAt: new Date('2026-09-28T01:00:00.000Z'),
    } as any;
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', userId: 'user-1' }) },
      walletTransaction: { findFirst: jest.fn().mockResolvedValue(transaction) },
      platformModel: { findMany: jest.fn().mockResolvedValue([]) },
      paymentOrder: {
        findFirst: jest.fn().mockResolvedValue({
          orderNo: 'LM2026092800001',
          amount: new Decimal('10'),
          paidAmount: new Decimal('9.99'),
          photonPerCny: new Decimal('10'),
          photonAmount: new Decimal('100'),
          providerTradeNo: 'TRADE-1',
          paymentMethod: 'ALIPAY',
          status: 'SUCCEEDED',
          paidAt: new Date('2026-09-28T01:02:00.000Z'),
          channel: { name: '测试支付' },
        }),
      },
    };
    const service = new WalletService(
      prisma as unknown as PrismaService,
      {} as RedisService,
      {} as AuditService,
    );

    await expect(service.getUserTransactionDetail('user-1', transaction.id)).resolves.toMatchObject({
      kind: 'RECHARGE',
      orderNo: 'LM2026092800001',
      providerTradeNo: 'TRADE-1',
      orderAmountCny: 10,
      paidAmountCny: 9.99,
      exchangeRate: 10,
      creditedPhotonAmount: 100,
      paymentMethod: 'ALIPAY',
      channelName: '测试支付',
      status: 'SUCCEEDED',
    });
  });

  it('returns image count and task cost for an image consumption transaction', async () => {
    const transaction = {
      id: 'transaction-image',
      walletId: 'wallet-1',
      type: 'CONSUME',
      amount: new Decimal('0.5'),
      balance: new Decimal('9'),
      reason: '生图: image-model',
      metadata: {
        model: 'image-model',
        taskId: 'task-1',
        imageId: 'image-1',
        sequence: 0,
        imageCount: 4,
        chargedImageCount: 1,
        perImageCost: 0.5,
      },
      idempotencyKey: 'image:task-1:0',
      createdAt: new Date('2026-09-28T02:00:00.000Z'),
    } as any;
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', userId: 'user-1' }) },
      walletTransaction: { findFirst: jest.fn().mockResolvedValue(transaction) },
      platformModel: {
        findMany: jest.fn().mockResolvedValue([{ name: 'image-model', displayName: '图片模型' }]),
      },
      imageGeneration: {
        findUnique: jest.fn().mockResolvedValue({
          cost: new Decimal('2'),
          parameters: { imageCount: 4 },
        }),
      },
    };
    const service = new WalletService(
      prisma as unknown as PrismaService,
      {} as RedisService,
      {} as AuditService,
    );

    await expect(service.getUserTransactionDetail('user-1', transaction.id)).resolves.toMatchObject({
      kind: 'IMAGE',
      model: '图片模型',
      requestedImageCount: 4,
      chargedImageCount: 1,
      perImageCost: 0.5,
      taskCost: 2,
      sequence: 0,
    });
  });
});
