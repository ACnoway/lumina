import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 初始化配置中的管理员账户。
   *
   * 管理端仍可使用邮箱验证码登录，ADMIN_PASSWORD 作为账户初始化时的
   * 密码哈希同时支持密码登录。
   */
  async onModuleInit(): Promise<void> {
    const adminEmail = this.normalizeEmail(this.config.get<string>('ADMIN_EMAIL', ''));
    if (!adminEmail) {
      this.logger.warn('ADMIN_EMAIL 未配置，跳过管理员账户初始化');
      return;
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existing) {
      const adminPassword = this.config.get<string>('ADMIN_PASSWORD', '');
      const password = adminPassword ? await bcrypt.hash(adminPassword, 12) : undefined;

      await this.create({
        email: adminEmail,
        password,
        role: UserRole.ADMIN,
      });
      this.logger.log(`管理员账户已创建: ${adminEmail}`);
      return;
    }

    if (existing.role === UserRole.USER) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ADMIN },
      });
      this.logger.log(`管理员账户角色已修复: ${adminEmail}`);
    }
  }

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
    password?: string;
    role?: UserRole;
  }): Promise<User> {
    const initialBalance = parseFloat(this.config.get<string>('INITIAL_BALANCE', '10.00'));

    this.logger.log(`Creating user ${data.email} with initial balance ${initialBalance}`);

    // 使用事务确保用户和钱包同时创建
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        nickname: data.nickname,
        avatar: data.avatar,
        role: data.role ?? UserRole.USER,
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

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
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
