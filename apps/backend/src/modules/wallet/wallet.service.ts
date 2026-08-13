import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly PREDEDUCT_TTL = 600; // 10分钟
  private readonly PREDEDUCT_KEY_PREFIX = 'wallet:pending:';

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
    if (amount <= 0) {
      throw new BadRequestException('预扣金额必须大于0');
    }

    const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

    // 幂等检查：如果已存在预扣记录，直接返回
    const existingPreDeduct = await this.redis.get(redisKey);
    if (existingPreDeduct) {
      const data = JSON.parse(existingPreDeduct);
      this.logger.log(
        `预扣已存在: userId=${userId}, idempotencyKey=${idempotencyKey}, amount=${data.amount}`,
      );
      return {
        success: true,
        message: '预扣已存在（幂等返回）',
        lockedAmount: data.amount,
      };
    }

    // 检查余额是否足够
    const wallet = await this.getWallet(userId);
    const balance = parseFloat(wallet.balance.toString());

    if (balance < amount) {
      this.logger.warn(
        `余额不足: userId=${userId}, balance=${balance}, required=${amount}`,
      );
      throw new BadRequestException(
        `余额不足，当前余额: ${balance.toFixed(2)} 元`,
      );
    }

    // 记录预扣到 Redis
    const preDeductData = {
      userId,
      amount,
      idempotencyKey,
      createdAt: Date.now(),
    };

    await this.redis.set(
      redisKey,
      JSON.stringify(preDeductData),
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
    if (actualAmount <= 0) {
      throw new BadRequestException('结算金额必须大于0');
    }

    const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

    // 检查是否已结算（幂等检查）
    const existingTransaction =
      await this.prisma.walletTransaction.findUnique({
        where: { idempotencyKey },
      });

    if (existingTransaction) {
      this.logger.log(
        `结算已存在: userId=${userId}, idempotencyKey=${idempotencyKey}`,
      );
      const wallet = await this.getWallet(userId);
      return {
        success: true,
        message: '结算已完成（幂等返回）',
        transaction: existingTransaction,
        balance: parseFloat(wallet.balance.toString()),
      };
    }

    // 检查预扣记录是否存在
    const preDeductData = await this.redis.get(redisKey);
    if (!preDeductData) {
      throw new BadRequestException('预扣记录不存在或已过期，请重新预扣');
    }

    const preDeduct = JSON.parse(preDeductData);
    if (actualAmount > preDeduct.amount) {
      throw new BadRequestException(
        `实际消费金额(${actualAmount})不能超过预扣金额(${preDeduct.amount})`,
      );
    }

    // 使用 Prisma 事务：扣减余额 + 写入交易记录
    // 注意：事务内抛出的 NestJS 异常需要原样传递，不能被 catch 吞掉
    const result = await this.prisma.$transaction(async (tx) => {
      // 获取当前余额并扣减
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new NotFoundException('钱包不存在');
      }

      const currentBalance = parseFloat(wallet.balance.toString());
      const newBalance = new Decimal(currentBalance - actualAmount);

      if (newBalance.lessThan(0)) {
        throw new BadRequestException('余额不足，无法完成结算');
      }

      // 更新余额
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      // 创建消费交易记录
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CONSUME',
          amount: new Decimal(actualAmount),
          balance: newBalance,
          reason,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
          idempotencyKey,
        },
      });

      return { transaction, newBalance };
    });

    // 结算成功后，清理 Redis 预扣记录
    await this.redis.del(redisKey);

    this.logger.log(
      `结算成功: userId=${userId}, idempotencyKey=${idempotencyKey}, actualAmount=${actualAmount}, newBalance=${result.newBalance}`,
    );

    return {
      success: true,
      message: '结算成功',
      transaction: result.transaction,
      balance: parseFloat(result.newBalance.toString()),
    };
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
    const redisKey = `${this.PREDEDUCT_KEY_PREFIX}${userId}:${idempotencyKey}`;

    // 检查预扣记录是否存在
    const preDeductData = await this.redis.get(redisKey);
    
    // 幂等：如果记录不存在，说明已经退回或已结算
    if (!preDeductData) {
      this.logger.log(
        `退回操作：预扣记录不存在或已处理, userId=${userId}, idempotencyKey=${idempotencyKey}`,
      );
      return {
        success: true,
        message: '退回成功（预扣记录已清理或不存在）',
      };
    }

    // 清理 Redis 预扣记录
    await this.redis.del(redisKey);

    this.logger.log(
      `退回成功: userId=${userId}, idempotencyKey=${idempotencyKey}, reason=${reason || '未指定'}`,
    );

    return {
      success: true,
      message: '退回成功',
    };
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
    if (amount <= 0) {
      throw new BadRequestException('充值金额必须大于0');
    }

    const key = idempotencyKey || `recharge:${userId}:${Date.now()}`;

    // 幂等检查
    if (idempotencyKey) {
      const existing = await this.prisma.walletTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        this.logger.log(`充值已存在: idempotencyKey=${idempotencyKey}`);
        return existing;
      }
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
  }

  /**
   * 管理员调整余额
   */
  async adminAdjust(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<WalletTransaction> {
    if (amount === 0) {
      throw new BadRequestException('调整金额不能为0');
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
  }
}
