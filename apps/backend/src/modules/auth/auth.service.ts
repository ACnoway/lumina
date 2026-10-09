import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as bcrypt from 'bcrypt';
import { Prisma, User } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { SmsChannelService } from '../sms/services/sms-channel.service';
import {
  AuthCodePurpose,
  IP_RATE_LIMIT,
  IP_RATE_LIMIT_TTL_SECONDS,
  PHONE_RATE_LIMIT,
  PHONE_RATE_LIMIT_TTL_SECONDS,
  SEND_COOLDOWN_TTL_SECONDS,
  VERIFICATION_CODE_TTL_SECONDS,
  getEmailCodeKey,
  getEmailCooldownKey,
  getSmsCodeKey,
  getSmsCooldownKey,
  getSmsIpRateKey,
  getSmsPhoneRateKey,
} from './auth.constants';
import { isValidPhone, normalizePhone } from './phone.util';

const BCRYPT_ROUNDS = 12;

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  }
  return fallback;
}

type AuthTarget = { type: 'email'; value: string } | { type: 'phone'; value: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly smsChannels?: SmsChannelService,
  ) {
    const smtpUser = this.config.get<string>('SMTP_USER')?.trim();
    const smtpPassword = this.config.get<string>('SMTP_PASSWORD');
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: parseBoolean(this.config.get('SMTP_SECURE', false), false),
      ...(smtpUser && smtpPassword ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
    });
  }

  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getEmailTarget(email: string): string {
    const normalized = this.normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('请输入有效的邮箱地址');
    }
    return normalized;
  }

  private resolveTarget(input: { email?: string; phone?: string; account?: string }): AuthTarget {
    const raw = input.account?.trim() || input.email?.trim() || input.phone?.trim();
    if (!raw) throw new BadRequestException('请输入邮箱或手机号');
    if (raw.includes('@')) return { type: 'email', value: this.getEmailTarget(raw) };
    const phone = normalizePhone(raw);
    if (!isValidPhone(phone)) throw new BadRequestException('请输入有效的手机号');
    return { type: 'phone', value: phone };
  }

  private async reserveSendCooldown(key: string): Promise<number | null> {
    if (await this.redis.setNX(key, '1', SEND_COOLDOWN_TTL_SECONDS)) return null;
    let ttl = await this.redis.ttl(key);
    if (ttl <= 0 && await this.redis.setNX(key, '1', SEND_COOLDOWN_TTL_SECONDS)) return null;
    if (ttl <= 0) ttl = await this.redis.ttl(key);
    return Math.max(1, ttl);
  }

  private async clearSendState(codeKey: string, cooldownKey: string): Promise<void> {
    await Promise.allSettled([this.redis.del(codeKey), this.redis.del(cooldownKey)]);
  }

  private async sendEmailCode(email: string, purpose: AuthCodePurpose): Promise<void> {
    const normalizedEmail = this.getEmailTarget(email);
    const existingUser = await this.usersService.findByEmail(normalizedEmail);
    if (purpose === 'register' && existingUser) throw new ConflictException('该邮箱已注册，请直接登录');
    if (purpose === 'login' && !existingUser) throw new BadRequestException('该邮箱尚未注册，请先注册');

    const codeKey = getEmailCodeKey(normalizedEmail, purpose);
    const cooldownKey = getEmailCooldownKey(normalizedEmail, purpose);
    const retryAfterSeconds = await this.reserveSendCooldown(cooldownKey);
    if (retryAfterSeconds !== null) throw new BadRequestException(`验证码已发送，请在 ${retryAfterSeconds} 秒后重试`);

    const code = this.generateCode();
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: normalizedEmail,
        subject: purpose === 'register' ? '【Lumina】注册验证码' : purpose === 'bind' ? '【Lumina】绑定验证邮箱验证码' : '【Lumina】登录验证码',
        html: `<div style="font-family:Arial,sans-serif;padding:20px"><h2>Lumina 验证码</h2><p>验证码为：</p><div style="font-size:32px;font-weight:bold;color:#C4612F;letter-spacing:8px;margin:20px 0">${code}</div><p style="color:#666">验证码5分钟内有效，请勿泄露给他人。</p></div>`,
      });
      await this.redis.set(codeKey, code, VERIFICATION_CODE_TTL_SECONDS);
      this.logger.log(`Verification email sent to ${normalizedEmail}`);
    } catch (error) {
      await this.clearSendState(codeKey, cooldownKey);
      this.logger.error(`Failed to send verification email: ${String(error)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }
  }

  /** Legacy-compatible email verification-code endpoint. */
  async sendCode(email: string, purpose: AuthCodePurpose = 'login'): Promise<void> {
    return this.sendEmailCode(email, purpose);
  }

  async sendSmsCode(phone: string, purpose: AuthCodePurpose = 'login', ip = 'unknown', ownerId?: string): Promise<void> {
    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) throw new BadRequestException('请输入有效的手机号');
    if (await this.redis.isRateLimited(getSmsPhoneRateKey(normalizedPhone), PHONE_RATE_LIMIT, PHONE_RATE_LIMIT_TTL_SECONDS)) {
      throw new BadRequestException('该手机号发送次数过多，请稍后再试');
    }
    if (await this.redis.isRateLimited(getSmsIpRateKey(ip || 'unknown'), IP_RATE_LIMIT, IP_RATE_LIMIT_TTL_SECONDS)) {
      throw new BadRequestException('请求过于频繁，请稍后再试');
    }

    const existingUser = await this.usersService.findByPhone(normalizedPhone);
    if (purpose === 'register' && existingUser) throw new ConflictException('该手机号已注册，请直接登录');
    if (purpose === 'bind' && existingUser && existingUser.id !== ownerId) throw new ConflictException('该手机号已被使用');
    // Login intentionally returns generic success for unknown phone numbers.
    if (purpose === 'login' && (!existingUser || !existingUser.phoneVerifiedAt)) return;
    if (!this.smsChannels) throw new BadRequestException('短信服务尚未配置，请联系管理员');

    const codeKey = getSmsCodeKey(normalizedPhone, purpose);
    const cooldownKey = getSmsCooldownKey(normalizedPhone, purpose);
    const retryAfterSeconds = await this.reserveSendCooldown(cooldownKey);
    if (retryAfterSeconds !== null) throw new BadRequestException(`验证码已发送，请在 ${retryAfterSeconds} 秒后重试`);
    const code = this.generateCode();
    try {
      await this.smsChannels.sendVerificationCode(normalizedPhone, code, purpose);
      await this.redis.set(codeKey, code, VERIFICATION_CODE_TTL_SECONDS);
      this.logger.log(`Verification SMS sent to ${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`);
    } catch (error) {
      await this.clearSendState(codeKey, cooldownKey);
      this.logger.error(`Failed to send verification SMS: ${String(error)}`);
      throw new BadRequestException('短信发送失败，请稍后重试');
    }
  }

  private async verifyCode(key: string, code: string): Promise<void> {
    const result = await this.redis.consumeVerificationCode(key, code);
    if (result !== 'matched') throw new UnauthorizedException('验证码错误或已过期');
  }

  async verifySmsCode(phone: string, code: string, purpose: AuthCodePurpose): Promise<void> {
    await this.verifyCode(getSmsCodeKey(normalizePhone(phone), purpose), code);
  }

  private ensureActive(user: User): void {
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('账号已被停用');
  }

  private issueToken(user: User): { accessToken: string; user: User } {
    this.ensureActive(user);
    const payload: { sub: string; email?: string; phone?: string } = { sub: user.id };
    if (user.email) payload.email = user.email;
    if (user.phone) payload.phone = user.phone;
    return { accessToken: this.jwtService.sign(payload), user };
  }

  private async findByTarget(target: AuthTarget): Promise<User | null> {
    return target.type === 'email'
      ? this.usersService.findByEmail(target.value)
      : this.usersService.findByPhone(target.value);
  }

  async login(account: string, code: string): Promise<{ accessToken: string; user: User }> {
    const target = this.resolveTarget({ account });
    if (target.type === 'email') await this.verifyCode(getEmailCodeKey(target.value, 'login'), code);
    else await this.verifySmsCode(target.value, code, 'login');
    const user = await this.findByTarget(target);
    if (!user) throw new BadRequestException('该账号尚未注册，请先注册');
    if (target.type === 'phone' && !user.phoneVerifiedAt) throw new BadRequestException('手机号尚未验证，请先绑定');
    return this.issueToken(user);
  }

  async passwordLogin(account: string, password: string): Promise<{ accessToken: string; user: User }> {
    const user = await this.findByTarget(this.resolveTarget({ account }));
    if (!user?.password || !(await bcrypt.compare(password, user.password))) throw new UnauthorizedException('邮箱或密码错误');
    return this.issueToken(user);
  }

  async register(data: {
    email?: string;
    phone?: string;
    verificationMethod?: 'email' | 'sms';
    code: string;
    password: string;
    confirmPassword: string;
    nickname?: string;
  }): Promise<{ accessToken: string; user: User }> {
    if (data.password !== data.confirmPassword) throw new BadRequestException('两次输入的密码不一致');
    const email = data.email?.trim() ? this.getEmailTarget(data.email) : undefined;
    const phone = data.phone?.trim() ? normalizePhone(data.phone) : undefined;
    if (!email && !phone) throw new BadRequestException('邮箱和手机号至少填写一种');
    if (phone && !isValidPhone(phone)) throw new BadRequestException('请输入有效的手机号');
    const method = data.verificationMethod ?? (email ? 'email' : 'sms');
    if (method === 'email') {
      if (!email) throw new BadRequestException('邮箱注册需要填写邮箱');
      await this.verifyCode(getEmailCodeKey(email, 'register'), data.code);
    } else {
      if (!phone) throw new BadRequestException('短信注册需要填写手机号');
      await this.verifySmsCode(phone, data.code, 'register');
    }

    const [existingEmail, existingPhone] = await Promise.all([
      email ? this.usersService.findByEmail(email) : Promise.resolve(null),
      phone ? this.usersService.findByPhone(phone) : Promise.resolve(null),
    ]);
    if (existingEmail || existingPhone) throw new ConflictException('邮箱或手机号已注册，请直接登录');

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    try {
      const user = await this.usersService.create({
        email,
        phone,
        phoneVerifiedAt: method === 'sms' ? new Date() : undefined,
        nickname: data.nickname?.trim() || undefined,
        password: passwordHash,
      });
      return this.issueToken(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('邮箱或手机号已注册，请直接登录');
      throw error;
    }
  }

  async bindPhone(userId: string, phone: string, code: string): Promise<User> {
    const normalized = normalizePhone(phone);
    await this.verifySmsCode(normalized, code, 'bind');
    return this.usersService.bindPhone(userId, normalized);
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.usersService.findById(userId);
  }
}
