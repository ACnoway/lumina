import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import {
  AdminOverviewResponse,
  AdminUserDto,
  AdminUsersResponse,
  GetTransactionsResponse,
  TransactionItem,
  WalletTransactionDto,
} from '@lumina/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { AdjustUserBalanceDto, ListAdminUsersQueryDto, UpdateUserStatusDto } from './dto/admin.dto';

const adminUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  nickname: true,
  avatar: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  wallet: {
    select: {
      id: true,
      balance: true,
    },
  },
});

type AdminUserRecord = Prisma.UserGetPayload<{
  select: typeof adminUserSelect;
}>;

export interface AuditRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(): Promise<AdminOverviewResponse> {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      walletBalance,
      totalModels,
      activeModels,
      totalProviders,
      activeProviders,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.platformModel.count(),
      this.prisma.platformModel.count({ where: { isActive: true } }),
      this.prisma.provider.count(),
      this.prisma.provider.count({ where: { isActive: true } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
      },
      wallets: {
        totalBalance: walletBalance._sum.balance
          ? Number(walletBalance._sum.balance.toString())
          : 0,
      },
      models: {
        total: totalModels,
        active: activeModels,
      },
      providers: {
        total: totalProviders,
        active: activeProviders,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async listUsers(query: ListAdminUsersQueryDto): Promise<AdminUsersResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { nickname: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map((user) => this.serializeUser(user)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUser(userId: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminUserSelect,
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.serializeUser(user);
  }

  async updateUserStatus(
    actor: User,
    userId: string,
    dto: UpdateUserStatusDto,
    context: AuditRequestContext,
  ): Promise<AdminUserDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: adminUserSelect,
      });

      if (!user) {
        throw new NotFoundException('用户不存在');
      }

      const result = await tx.user.update({
        where: { id: userId },
        data: { status: dto.status },
        select: adminUserSelect,
      });

      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'user.status.updated',
          resource: 'user',
          details: {
            targetId: userId,
            before: { status: user.status },
            after: { status: result.status },
          },
          ...context,
        },
        tx,
      );

      return result;
    });

    return this.serializeUser(updated);
  }

  async adjustUserBalance(
    actor: User,
    dto: AdjustUserBalanceDto,
    context: AuditRequestContext,
  ): Promise<WalletTransactionDto> {
    const transaction = await this.walletService.adminAdjust(dto.userId, dto.amount, dto.reason, {
      actorId: actor.id,
      ...context,
    });

    return {
      id: transaction.id,
      type: transaction.type,
      amount: Number(transaction.amount.toString()),
      balance: Number(transaction.balance.toString()),
      reason: transaction.reason,
      createdAt: transaction.createdAt.toISOString(),
    };
  }

  async getUserTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<GetTransactionsResponse> {
    await this.getUser(userId);
    const { transactions, total } = await this.walletService.getTransactions(userId, page, limit);

    const items: TransactionItem[] = transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: Number(transaction.amount.toString()),
      balance: Number(transaction.balance.toString()),
      reason: transaction.reason,
      createdAt: transaction.createdAt.toISOString(),
      metadata: transaction.metadata as Record<string, unknown> | undefined,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private serializeUser(user: AdminUserRecord): AdminUserDto {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      wallet: user.wallet
        ? {
            id: user.wallet.id,
            balance: Number(user.wallet.balance.toString()),
          }
        : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
