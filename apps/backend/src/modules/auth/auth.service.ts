import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { User } from '@prisma/client';

const VERIFICATION_CODE_TTL_SECONDS = 300;
const SEND_COOLDOWN_TTL_SECONDS = 60;

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  }
  return fallback;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    // 初始化邮件发送器
    const smtpUser = this.config.get<string>('SMTP_USER')?.trim();
    const smtpPassword = this.config.get<string>('SMTP_PASSWORD');
    const transportOptions = {
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: parseBoolean(this.config.get('SMTP_SECURE', false), false),
      ...(smtpUser && smtpPassword
        ? { auth: { user: smtpUser, pass: smtpPassword } }
        : {}),
    };
    this.transporter = nodemailer.createTransport(transportOptions);
  }

  /**
   * 生成6位随机验证码
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getCodeKey(email: string): string {
    return `auth:code:${email}`;
  }

  private getCooldownKey(email: string): string {
    return `auth:code:cooldown:${email}`;
  }

  private async clearSendState(email: string, clearCode: boolean): Promise<void> {
    const keys = [this.getCooldownKey(email)];
    if (clearCode) {
      keys.push(this.getCodeKey(email));
    }

    const results = await Promise.allSettled(keys.map((key) => this.redis.del(key)));

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(`Failed to clear auth state ${keys[index]}: ${String(result.reason)}`);
      }
    });
  }

  private async reserveSendCooldown(cooldownKey: string): Promise<number | null> {
    const acquired = await this.redis.setNX(cooldownKey, '1', SEND_COOLDOWN_TTL_SECONDS);
    if (acquired) {
      return null;
    }

    // TTL 过期与读取之间可能发生竞态，重新尝试一次，避免把已结束的
    // 冷却窗口错误地报告给用户。
    let ttl = await this.redis.ttl(cooldownKey);
    if (ttl <= 0) {
      if (await this.redis.setNX(cooldownKey, '1', SEND_COOLDOWN_TTL_SECONDS)) {
        return null;
      }
      ttl = await this.redis.ttl(cooldownKey);
    }

    return Math.max(1, ttl);
  }

  /**
   * 发送验证码
   */
  async sendCode(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const codeKey = this.getCodeKey(normalizedEmail);
    const cooldownKey = this.getCooldownKey(normalizedEmail);

    // 使用独立的短期 key 原子限频，避免并发请求重复投递邮件。
    const retryAfterSeconds = await this.reserveSendCooldown(cooldownKey);
    if (retryAfterSeconds !== null) {
      throw new BadRequestException(`验证码已发送，请在 ${retryAfterSeconds} 秒后重试`);
    }

    const code = this.generateCode();

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: normalizedEmail,
        subject: '【AI聊天生图平台】登录验证码',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>您的登录验证码</h2>
            <p>您正在登录 AI聊天生图平台，验证码为：</p>
            <div style="font-size: 32px; font-weight: bold; color: #C4612F; letter-spacing: 8px; margin: 20px 0;">
              ${code}
            </div>
            <p style="color: #666;">验证码5分钟内有效，请勿泄露给他人。</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              如果这不是您的操作，请忽略此邮件。
            </p>
          </div>
        `,
      });

      // 只有邮件投递成功后才保留验证码，避免失败请求留下可登录状态。
      await this.redis.set(codeKey, code, VERIFICATION_CODE_TTL_SECONDS);
      this.logger.log(`Verification code sent to ${normalizedEmail}`);
    } catch (error) {
      await this.clearSendState(normalizedEmail, true);
      this.logger.error(`Failed to send verification code to ${normalizedEmail}: ${String(error)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }
  }

  /**
   * 验证码登录/注册
   */
  async login(email: string, code: string): Promise<{ accessToken: string; user: User }> {
    const normalizedEmail = this.normalizeEmail(email);
    const codeKey = this.getCodeKey(normalizedEmail);
    const storedCode = await this.redis.get(codeKey);

    // 验证码校验
    if (!storedCode || storedCode !== code) {
      // 验证码错误，删除 Redis 中的 key，防止暴力枚举
      if (storedCode) {
        await this.redis.del(codeKey);
      }
      throw new UnauthorizedException('验证码错误或已过期');
    }

    // 验证码正确，删除已使用的验证码
    await this.redis.del(codeKey);

    // 查找或创建用户
    let user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      this.logger.log(`New user registration: ${normalizedEmail}`);
      // 新用户，自动注册
      const userWithWallet = await this.usersService.create({
        email: normalizedEmail,
      });
      user = userWithWallet;
    } else {
      this.logger.log(`Existing user login: ${normalizedEmail}`);
    }

    // 签发 JWT
    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, user };
  }

  /**
   * 验证用户（由 JWT 策略调用）
   */
  async validateUser(userId: string): Promise<User | null> {
    return this.usersService.findById(userId);
  }
}
