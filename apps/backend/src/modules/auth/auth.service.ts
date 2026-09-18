import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as bcrypt from 'bcrypt';
import { Prisma, User } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';

const VERIFICATION_CODE_TTL_SECONDS = 300;
const SEND_COOLDOWN_TTL_SECONDS = 60;
const BCRYPT_ROUNDS = 12;

type CodePurpose = 'login' | 'register';

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
      ...(smtpUser && smtpPassword ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
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

  private getCodeKey(email: string, purpose: CodePurpose): string {
    return `auth:code:${purpose}:${email}`;
  }

  private getCooldownKey(email: string, purpose: CodePurpose): string {
    return `auth:code:cooldown:${purpose}:${email}`;
  }

  private async clearSendState(
    email: string,
    purpose: CodePurpose,
    clearCode: boolean,
  ): Promise<void> {
    const keys = [this.getCooldownKey(email, purpose)];
    if (clearCode) {
      keys.push(this.getCodeKey(email, purpose));
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
  async sendCode(email: string, purpose: CodePurpose = 'login'): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (purpose === 'register' && existingUser) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }

    if (purpose === 'login' && !existingUser) {
      throw new BadRequestException('该邮箱尚未注册，请先注册');
    }

    const codeKey = this.getCodeKey(normalizedEmail, purpose);
    const cooldownKey = this.getCooldownKey(normalizedEmail, purpose);

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
        subject: purpose === 'register' ? '【Lumina】注册验证码' : '【Lumina】登录验证码',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${purpose === 'register' ? '您的注册验证码' : '您的登录验证码'}</h2>
            <p>您正在${purpose === 'register' ? '注册 Lumina 账号' : '登录 Lumina'}，验证码为：</p>
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
      await this.clearSendState(normalizedEmail, purpose, true);
      this.logger.error(`Failed to send verification code to ${normalizedEmail}: ${String(error)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }
  }

  private async verifyCode(email: string, code: string, purpose: CodePurpose): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await this.redis.consumeVerificationCode(
      this.getCodeKey(normalizedEmail, purpose),
      code,
    );

    if (result !== 'matched') {
      throw new UnauthorizedException('验证码错误或已过期');
    }
  }

  private ensureActive(user: User): void {
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('账号已被停用');
    }
  }

  private issueToken(user: User): { accessToken: string; user: User } {
    this.ensureActive(user);
    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, user };
  }

  /**
   * 验证码登录，仅允许已注册用户登录。
   */
  async login(email: string, code: string): Promise<{ accessToken: string; user: User }> {
    const normalizedEmail = this.normalizeEmail(email);
    await this.verifyCode(normalizedEmail, code, 'login');

    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('该邮箱尚未注册，请先注册');
    }

    this.logger.log(`Existing user code login: ${normalizedEmail}`);
    return this.issueToken(user);
  }

  /**
   * 密码登录。
   */
  async passwordLogin(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; user: User }> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    this.logger.log(`Password login: ${normalizedEmail}`);
    return this.issueToken(user);
  }

  /**
   * 注册新用户并初始化钱包。
   */
  async register(data: {
    email: string;
    code: string;
    password: string;
    confirmPassword: string;
    nickname?: string;
  }): Promise<{ accessToken: string; user: User }> {
    if (data.password !== data.confirmPassword) {
      throw new BadRequestException('两次输入的密码不一致');
    }

    const normalizedEmail = this.normalizeEmail(data.email);
    await this.verifyCode(normalizedEmail, data.code, 'register');

    const existingUser = await this.usersService.findByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const nickname = data.nickname?.trim() || undefined;

    try {
      const user = await this.usersService.create({
        email: normalizedEmail,
        nickname,
        password: passwordHash,
      });

      this.logger.log(`New user registered: ${normalizedEmail}`);
      return this.issueToken(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该邮箱已注册，请直接登录');
      }
      throw error;
    }
  }

  /**
   * 验证用户（由 JWT 策略调用）
   */
  async validateUser(userId: string): Promise<User | null> {
    return this.usersService.findById(userId);
  }
}
