import 'reflect-metadata';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

class InMemoryAuthRedis {
  private readonly values = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    this.removeIfExpired(key);
    return this.values.get(key) || null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.values.set(key, value);
    if (ttl) {
      this.expiresAt.set(key, Date.now() + ttl * 1000);
    }
  }

  async setNX(key: string, value: string, ttl?: number): Promise<boolean> {
    this.removeIfExpired(key);
    if (this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);
    if (ttl) {
      this.expiresAt.set(key, Date.now() + ttl * 1000);
    }
    return true;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.expiresAt.delete(key);
  }

  async ttl(key: string): Promise<number> {
    this.removeIfExpired(key);
    const expiresAt = this.expiresAt.get(key);
    if (!this.values.has(key) || expiresAt === undefined) {
      return -2;
    }
    return Math.ceil((expiresAt - Date.now()) / 1000);
  }

  private removeIfExpired(key: string): void {
    const expiresAt = this.expiresAt.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }
}

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    password: null,
    nickname: null,
    avatar: null,
    role: 'USER',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function createService() {
  const redis = new InMemoryAuthRedis();
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-1' });
  const createTransport = nodemailer.createTransport as jest.Mock;
  createTransport.mockReturnValue({ sendMail });

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        SMTP_HOST: 'smtp.test.local',
        SMTP_PORT: 2525,
        // ConfigModule reads process environment values as strings.
        SMTP_SECURE: 'false',
        SMTP_USER: 'test-user',
        SMTP_PASSWORD: 'test-password',
        SMTP_FROM: 'Lumina <no-reply@test.local>',
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  const users = {
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(createUser()),
  } as unknown as UsersService;
  const jwt = {
    sign: jest.fn().mockReturnValue('jwt-token'),
  } as unknown as JwtService;

  return {
    service: new AuthService(redis as unknown as RedisService, users, jwt, config),
    redis,
    sendMail,
    users,
    jwt,
  };
}

describe('AuthService verification codes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes the email and stores the code only after delivery succeeds', async () => {
    const store = createService();

    await store.service.sendCode('  User@Example.COM ');

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com' }),
    );
    await expect(store.redis.get('auth:code:user@example.com')).resolves.toMatch(/^\d{6}$/);
    await expect(store.redis.ttl('auth:code:user@example.com')).resolves.toBe(300);
    await expect(store.redis.ttl('auth:code:cooldown:user@example.com')).resolves.toBe(60);
  });

  it('treats string SMTP_SECURE=false as plain SMTP', () => {
    const createTransport = nodemailer.createTransport as jest.Mock;
    createService();

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false }),
    );
  });

  it('clears the code and cooldown when mail delivery fails', async () => {
    const store = createService();
    store.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(store.service.sendCode('user@example.com')).rejects.toThrow(
      new BadRequestException('邮件发送失败，请稍后重试'),
    );

    await expect(store.redis.get('auth:code:user@example.com')).resolves.toBeNull();
    await expect(store.redis.get('auth:code:cooldown:user@example.com')).resolves.toBeNull();

    await store.service.sendCode('user@example.com');
    expect(store.sendMail).toHaveBeenCalledTimes(2);
  });

  it('enforces a 60-second cooldown without sending another email', async () => {
    const store = createService();

    await store.service.sendCode('user@example.com');
    await expect(store.service.sendCode('USER@example.com')).rejects.toThrow(
      '验证码已发送，请在 60 秒后重试',
    );

    expect(store.sendMail).toHaveBeenCalledTimes(1);
  });

  it('prevents concurrent requests from delivering duplicate emails', async () => {
    const store = createService();
    let releaseFirstDelivery!: () => void;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirstDelivery = resolve;
    });
    store.sendMail.mockImplementationOnce(() => firstDelivery);

    const firstRequest = store.service.sendCode('User@Example.COM');
    await expect(store.service.sendCode(' user@example.com ')).rejects.toThrow(
      '验证码已发送，请在 60 秒后重试',
    );

    releaseFirstDelivery();
    await firstRequest;
    expect(store.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes the email and makes a valid code one-time', async () => {
    const store = createService();
    const user = createUser();
    store.users.findByEmail = jest.fn().mockResolvedValue(user);
    await store.redis.set('auth:code:user@example.com', '123456', 300);

    const result = await store.service.login(' User@Example.COM ', '123456');

    expect(result.accessToken).toBe('jwt-token');
    expect(store.users.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(store.jwt.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
    });
    await expect(store.redis.get('auth:code:user@example.com')).resolves.toBeNull();
    await expect(store.service.login('user@example.com', '123456')).rejects.toThrow(
      new UnauthorizedException('验证码错误或已过期'),
    );
  });

  it('invalidates a stored code after a failed login attempt', async () => {
    const store = createService();
    await store.redis.set('auth:code:user@example.com', '123456', 300);

    await expect(store.service.login('user@example.com', '654321')).rejects.toThrow(
      new UnauthorizedException('验证码错误或已过期'),
    );

    await expect(store.redis.get('auth:code:user@example.com')).resolves.toBeNull();
    expect(store.users.findByEmail).not.toHaveBeenCalled();
  });
});
