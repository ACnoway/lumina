import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 根据 ID 查询用户
   */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * 根据邮箱查询用户
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * 创建用户（同时创建钱包并赋予初始额度）
   */
  async create(data: {
    email: string;
    nickname?: string;
    avatar?: string;
  }): Promise<User> {
    const initialBalance = parseFloat(
      this.config.get<string>('INITIAL_BALANCE', '10.00'),
    );

    this.logger.log(
      `Creating user ${data.email} with initial balance ${initialBalance}`,
    );

    // 使用事务确保用户和钱包同时创建
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        nickname: data.nickname,
        avatar: data.avatar,
        wallet: {
          create: {
            balance: initialBalance,
            transactions: {
              create: {
                type: 'RECHARGE',
                amount: initialBalance,
                balance: initialBalance,
                reason: '新用户注册赠送',
                idempotencyKey: `init:${data.email}:${Date.now()}`,
              },
            },
          },
        },
      },
    });

    this.logger.log(`User ${user.id} created successfully`);
    return user;
  }

  /**
   * 获取用户及其钱包信息
   */
  async findByIdWithWallet(
    id: string,
  ): Promise<(User & { wallet: { id: string; balance: any } | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
      },
    });
  }
}
