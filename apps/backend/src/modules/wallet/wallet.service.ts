import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Decimal } from '@prisma/client/runtime/library';
import { Wallet, WalletTransaction } from '@prisma/client';

interface PreDeductResult {
  success: boolean;
  message: string;
  lockedAmount: number;
}

interface SettleResult {
  success: boolean;
  message: string;
  transaction?: WalletTransaction;
  balance: number;
}

interface RefundResult {
  success: boolean;
  message: string;
}

interface PreDeductData {
  userId: string;
  amount: number;
  idempotencyKey: string;
  createdAt: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly PREDEDUCT_TTL = 600; // 10分钟
  private readonly PREDEDUCT_KEY_PREFIX = 'wallet:pending:';
  private readonly RESERVATION_INDEX_PREFIX = 'wallet:reservations:';
  private readonly WALLET_LOCK_PREFIX = 'wallet:lock:';
  private readonly WALLET_LOCK_TTL = 30;
  private readonly WALLET_LOCK_WAIT_TIMEOUT = 5000;
  private readonly WALLET_LOCK_RETRY_DELAY = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 获取钱包信息
   */
  async getWallet(userId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('钱包不存在');
    }

    return wallet;
  }

  /**
   * 预扣 - 第一阶段：锁定金额但不扣减数据库余额
   * @param userId 用户ID
   * @param amount 预扣金额
   * @param idempotencyKey 幂等键
   */
  async preDeduct(
    userId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<PreDeductResult> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('预扣金额必须大于0');
    }

    const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

    return this.withWalletLock(userId, async () => {
      // 幂等检查必须位于用户锁内，避免并发请求同时通过检查。
      const existingPreDeduct = await this.redis.get(redisKey);
      if (existingPreDeduct) {
        const data = JSON.parse(existingPreDeduct) as PreDeductData;
        this.logger.log(
          `预扣已存在: userId=${userId}, idempotencyKey=${idempotencyKey}, amount=${data.amount}`,
        );
        return {
          success: true,
          message: '预扣已存在（幂等返回）',
          lockedAmount: data.amount,
        };
      }

      // 余额和该用户所有尚未结算的预扣一起检查。索引中的过期项会在这里清理。
      const wallet = await this.getWallet(userId);
      const balance = parseFloat(wallet.balance.toString());
      const reservedAmount = await this.getReservedAmount(userId);
      const availableBalance = balance - reservedAmount;

      if (availableBalance < amount) {
        this.logger.warn(
          `余额不足: userId=${userId}, balance=${balance}, reserved=${reservedAmount}, required=${amount}`,
        );
        throw new BadRequestException(
          `余额不足，当前可用余额: ${Math.max(availableBalance, 0).toFixed(2)} 元`,
        );
      }

      const preDeductData: PreDeductData = {
        userId,
        amount,
        idempotencyKey,
        createdAt: Date.now(),
      };
      const serializedData = JSON.stringify(preDeductData);

      await this.redis.setPreDeduct(
        redisKey,
        this.reservationIndexKey(userId),
        idempotencyKey,
        serializedData,
        this.PREDEDUCT_TTL,
      );

      this.logger.log(
        `预扣成功: userId=${userId}, idempotencyKey=${idempotencyKey}, amount=${amount}`,
      );

      return {
        success: true,
        message: '预扣成功',
        lockedAmount: amount,
      };
    });
  }

  /**
   * 结算 - 第二阶段：实际扣减余额并写入交易记录
   * @param userId 用户ID
   * @param actualAmount 实际消费金额
   * @param idempotencyKey 幂等键（必须与预扣时相同）
   * @param reason 交易原因
   * @param metadata 额外元数据
   */
  async settle(
    userId: string,
    actualAmount: number,
    idempotencyKey: string,
    reason: string,
    metadata?: any,
  ): Promise<SettleResult> {
    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      throw new BadRequestException('结算金额必须大于0');
    }

    const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

    return this.withWalletLock(userId, async () => {
      // 检查是否已结算（幂等检查）。放在锁内可避免两个并发 settle 都通过检查。
      const existingTransaction =
        await this.prisma.walletTransaction.findUnique({
          where: { idempotencyKey },
        });

      if (existingTransaction) {
        const wallet = await this.getWallet(userId);
        if (existingTransaction.walletId !== wallet.id) {
          throw new BadRequestException('幂等键已被其他钱包使用');
        }

        this.logger.log(
          `结算已存在: userId=${userId}, idempotencyKey=${idempotencyKey}`,
        );
        return {
          success: true,
          message: '结算已完成（幂等返回）',
          transaction: existingTransaction,
          balance: parseFloat(wallet.balance.toString()),
        };
      }

      const preDeductData = await this.redis.get(redisKey);
      if (!preDeductData) {
        throw new BadRequestException('预扣记录不存在或已过期，请重新预扣');
      }

      const preDeduct = JSON.parse(preDeductData) as PreDeductData;
      if (actualAmount > preDeduct.amount) {
        throw new BadRequestException(
          `实际消费金额(${actualAmount})不能超过预扣金额(${preDeduct.amount})`,
        );
      }

      // 使用数据库条件更新作为最后一道资金安全边界。即使锁过期或有其他进程直接写库，
      // 也不会允许余额被扣成负数或发生丢失更新。
      const result = await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('钱包不存在');
        }

        const updated = await tx.wallet.updateMany({
          where: {
            id: wallet.id,
            balance: { gte: new Decimal(actualAmount) },
          },
          data: {
            balance: { decrement: new Decimal(actualAmount) },
          },
        });

        if (updated.count !== 1) {
          throw new BadRequestException('余额不足，无法完成结算');
        }

        const updatedWallet = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        if (!updatedWallet) {
          throw new NotFoundException('钱包不存在');
        }

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'CONSUME',
            amount: new Decimal(actualAmount),
            balance: updatedWallet.balance,
            reason,
            metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
            idempotencyKey,
          },
        });

        return { transaction, newBalance: updatedWallet.balance };
      });

      await this.removePreDeduct(userId, idempotencyKey);

      this.logger.log(
        `结算成功: userId=${userId}, idempotencyKey=${idempotencyKey}, actualAmount=${actualAmount}, newBalance=${result.newBalance}`,
      );

      return {
        success: true,
        message: '结算成功',
        transaction: result.transaction,
        balance: parseFloat(result.newBalance.toString()),
      };
    });
  }

  /**
   * 退回 - 第三阶段：取消预扣，清理 Redis 记录
   * @param userId 用户ID
   * @param idempotencyKey 幂等键
   * @param reason 退回原因
   */
  async refund(
    userId: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<RefundResult> {
    return this.withWalletLock(userId, async () => {
      const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

      // 幂等：如果记录不存在，说明已经退回或已结算
      const preDeductData = await this.redis.get(redisKey);
      if (!preDeductData) {
        this.logger.log(
          `退回操作：预扣记录不存在或已处理, userId=${userId}, idempotencyKey=${idempotencyKey}`,
        );
        return {
          success: true,
          message: '退回成功（预扣记录已清理或不存在）',
        };
      }

      await this.removePreDeduct(userId, idempotencyKey);

      this.logger.log(
        `退回成功: userId=${userId}, idempotencyKey=${idempotencyKey}, reason=${reason || '未指定'}`,
      );

      return {
        success: true,
        message: '退回成功',
      };
    });
  }

  /**
   * 分页查询交易记录
   */
  async getTransactions(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const wallet = await this.getWallet(userId);

    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.walletTransaction.count({
        where: { walletId: wallet.id },
      }),
    ]);

    return { transactions, total };
  }

  /**
   * 充值（管理员用）
   */
  async recharge(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string,
  ): Promise<WalletTransaction> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('充值金额必须大于0');
    }

    const key = idempotencyKey || `recharge:${userId}:${Date.now()}`;

    return this.withWalletLock(userId, async () => {
      const existing = await this.prisma.walletTransaction.findUnique({
        where: { idempotencyKey: key },
      });

      if (existing) {
        const wallet = await this.getWallet(userId);
        if (existing.walletId !== wallet.id) {
          throw new BadRequestException('幂等键已被其他钱包使用');
        }
        this.logger.log(`充值已存在: idempotencyKey=${key}`);
        return existing;
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('钱包不存在');
        }

        const currentBalance = parseFloat(wallet.balance.toString());
        const newBalance = new Decimal(currentBalance + amount);

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: newBalance },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'RECHARGE',
            amount: new Decimal(amount),
            balance: newBalance,
            reason,
            idempotencyKey: key,
          },
        });

        return transaction;
      });

      this.logger.log(
        `充值成功: userId=${userId}, amount=${amount}, newBalance=${result.balance}`,
      );

      return result;
    });
  }

  /**
   * 管理员调整余额
   */
  async adminAdjust(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<WalletTransaction> {
    if (!Number.isFinite(amount) || amount === 0) {
      throw new BadRequestException('调整金额不能为0');
    }

    return this.withWalletLock(userId, async () => {
      const result = await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('钱包不存在');
        }

        const currentBalance = parseFloat(wallet.balance.toString());
        const newBalance = new Decimal(currentBalance + amount);

        if (newBalance.lessThan(0)) {
          throw new BadRequestException('调整后余额不能为负数');
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: newBalance },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'ADMIN_ADJUST',
            amount: new Decimal(amount),
            balance: newBalance,
            reason,
            idempotencyKey: `admin_adjust:${userId}:${Date.now()}`,
          },
        });

        return transaction;
      });

      this.logger.log(
        `管理员调整成功: userId=${userId}, amount=${amount}, newBalance=${result.balance}, reason=${reason}`,
      );

      return result;
    });
  }

  private reservationIndexKey(userId: string): string {
    return `${this.RESERVATION_INDEX_PREFIX}${userId}`;
  }

  private async getReservedAmount(userId: string): Promise<number> {
    const indexKey = this.reservationIndexKey(userId);
    const reservations = (await this.redis.hGetAll(indexKey)) || {};
    const now = Date.now();
    let total = 0;

    for (const [idempotencyKey, serializedData] of Object.entries(
      reservations,
    )) {
      let data: PreDeductData;
      try {
        data = JSON.parse(serializedData) as PreDeductData;
      } catch {
        await this.redis.removePreDeduct(
          `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`,
          indexKey,
          idempotencyKey,
        );
        continue;
      }

      const isValid =
        data.userId === userId &&
        Number.isFinite(data.amount) &&
        data.amount > 0 &&
        Number.isFinite(data.createdAt);
      const isExpired =
        !isValid || data.createdAt + this.PREDEDUCT_TTL * 1000 <= now;

      if (isExpired) {
        await this.redis.removePreDeduct(
          `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`,
          indexKey,
          idempotencyKey,
        );
        continue;
      }

      total += data.amount;
    }

    return total;
  }

  private async removePreDeduct(
    userId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.redis.removePreDeduct(
      `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`,
      this.reservationIndexKey(userId),
      idempotencyKey,
    );
  }

  private async withWalletLock<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${this.WALLET_LOCK_PREFIX}${userId}`;
    const token = randomUUID();
    const deadline = Date.now() + this.WALLET_LOCK_WAIT_TIMEOUT;

    while (!(await this.redis.setNX(lockKey, token, this.WALLET_LOCK_TTL))) {
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException('钱包服务繁忙，请稍后重试');
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.WALLET_LOCK_RETRY_DELAY);
      });
    }

    try {
      return await operation();
    } finally {
      try {
        await this.redis.releaseLock(lockKey, token);
      } catch (error) {
        this.logger.error(`释放钱包锁失败: userId=${userId}, error=${error}`);
      }
    }
  }
}
