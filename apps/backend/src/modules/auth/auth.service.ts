import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { User } from '@prisma/client';

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
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  /**
   * 生成6位随机验证码
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 发送验证码
   */
  async sendCode(email: string): Promise<void> {
    // 检查是否在60秒内已发送过验证码
    const codeKey = `auth:code:${email}`;
    const existingCode = await this.redis.get(codeKey);
    
    if (existingCode) {
      const ttl = await this.redis.ttl(codeKey);
      if (ttl > 240) { // 5分钟 TTL，如果剩余超过4分钟说明刚发送过
        throw new BadRequestException(
          `验证码已发送，请在 ${Math.ceil((300 - (300 - ttl)) / 60)} 分钟后重试`,
        );
      }
    }

    // 生成验证码
    const code = this.generateCode();

    // 存入 Redis，TTL 5分钟
    await this.redis.set(codeKey, code, 300);

    this.logger.log(`Send verification code to ${email}: ${code}`);

    // 发送邮件
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: email,
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

      this.logger.log(`Verification code sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}:`, error);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }
  }

  /**
   * 验证码登录/注册
   */
  async login(
    email: string,
    code: string,
  ): Promise<{ accessToken: string; user: User }> {
    const codeKey = `auth:code:${email}`;
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
    let user = await this.usersService.findByEmail(email);

    if (!user) {
      this.logger.log(`New user registration: ${email}`);
      // 新用户，自动注册
      const userWithWallet = await this.usersService.create({ email });
      user = userWithWallet;
    } else {
      this.logger.log(`Existing user login: ${email}`);
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
