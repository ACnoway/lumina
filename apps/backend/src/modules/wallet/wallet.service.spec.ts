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
});
