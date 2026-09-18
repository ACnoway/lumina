import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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
    if (ttl) this.expiresAt.set(key, Date.now() + ttl * 1000);
  }

  async setNX(key: string, value: string, ttl?: number): Promise<boolean> {
    this.removeIfExpired(key);
    if (this.values.has(key)) return false;

    await this.set(key, value, ttl);
    return true;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.expiresAt.delete(key);
  }

  async ttl(key: string): Promise<number> {
    this.removeIfExpired(key);
    const expiresAt = this.expiresAt.get(key);
    if (!this.values.has(key) || expiresAt === undefined) return -2;
    return Math.ceil((expiresAt - Date.now()) / 1000);
  }

  async consumeVerificationCode(
    key: string,
    expected: string,
  ): Promise<'matched' | 'mismatch' | 'missing'> {
    const stored = await this.get(key);
    await this.del(key);
    if (!stored) return 'missing';
    return stored === expected ? 'matched' : 'mismatch';
  }

  private removeIfExpired(key: string): void {
    const expiresAt = this.expiresAt.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }
}

function createUser(overrides: Partial<User> = {}): User {
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
    ...overrides,
  };
}

function createService(existingUser: User | null = null) {
  const redis = new InMemoryAuthRedis();
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-1' });
  const createTransport = nodemailer.createTransport as jest.Mock;
  createTransport.mockReturnValue({ sendMail });

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        SMTP_HOST: 'smtp.test.local',
        SMTP_PORT: 2525,
        SMTP_SECURE: 'false',
        SMTP_USER: 'test-user',
        SMTP_PASSWORD: 'test-password',
        SMTP_FROM: 'Lumina <no-reply@test.local>',
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;

  const users = {
    findByEmail: jest.fn().mockResolvedValue(existingUser),
    create: jest.fn().mockImplementation(async (data: Partial<User>) =>
      createUser({
        email: data.email,
        nickname: data.nickname ?? null,
        password: data.password ?? null,
      }),
    ),
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

  it('normalizes registration email and stores a purpose-scoped code after delivery', async () => {
    const store = createService();

    await store.service.sendCode('  User@Example.COM ', 'register');

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: '【Lumina】注册验证码',
      }),
    );
    await expect(store.redis.get('auth:code:register:user@example.com')).resolves.toMatch(/^\d{6}$/);
    await expect(store.redis.ttl('auth:code:register:user@example.com')).resolves.toBe(300);
    await expect(store.redis.ttl('auth:code:cooldown:register:user@example.com')).resolves.toBe(60);
  });

  it('only sends login codes to existing users', async () => {
    const unknownUser = createService();
    await expect(unknownUser.service.sendCode('user@example.com', 'login')).rejects.toThrow(
      new BadRequestException('该邮箱尚未注册，请先注册'),
    );

    const existingUser = createService(createUser());
    await expect(existingUser.service.sendCode('user@example.com', 'login')).resolves.toBeUndefined();
  });

  it('rejects registration codes for existing users', async () => {
    const store = createService(createUser());

    await expect(store.service.sendCode('user@example.com', 'register')).rejects.toThrow(
      new ConflictException('该邮箱已注册，请直接登录'),
    );
    expect(store.sendMail).not.toHaveBeenCalled();
  });

  it('clears the purpose-scoped code and cooldown when mail delivery fails', async () => {
    const store = createService();
    store.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(store.service.sendCode('user@example.com', 'register')).rejects.toThrow(
      new BadRequestException('邮件发送失败，请稍后重试'),
    );

    await expect(store.redis.get('auth:code:register:user@example.com')).resolves.toBeNull();
    await expect(store.redis.get('auth:code:cooldown:register:user@example.com')).resolves.toBeNull();

    await store.service.sendCode('user@example.com', 'register');
    expect(store.sendMail).toHaveBeenCalledTimes(2);
  });

  it('enforces a 60-second cooldown without sending another email', async () => {
    const store = createService();

    await store.service.sendCode('user@example.com', 'register');
    await expect(store.service.sendCode('USER@example.com', 'register')).rejects.toThrow(
      '验证码已发送，请在 60 秒后重试',
    );

    expect(store.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService login and registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs an existing user in with a one-time code', async () => {
    const store = createService(createUser());
    await store.redis.set('auth:code:login:user@example.com', '123456', 300);

    const result = await store.service.login(' User@Example.COM ', '123456');

    expect(result.accessToken).toBe('jwt-token');
    expect(store.jwt.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
    });
    await expect(store.redis.get('auth:code:login:user@example.com')).resolves.toBeNull();
    await expect(store.service.login('user@example.com', '123456')).rejects.toThrow(
      new UnauthorizedException('验证码错误或已过期'),
    );
  });

  it('invalidates a stored code after a failed login attempt', async () => {
    const store = createService(createUser());
    await store.redis.set('auth:code:login:user@example.com', '123456', 300);

    await expect(store.service.login('user@example.com', '654321')).rejects.toThrow(
      new UnauthorizedException('验证码错误或已过期'),
    );
    await expect(store.redis.get('auth:code:login:user@example.com')).resolves.toBeNull();
  });

  it('does not auto-create a user when a login code is presented', async () => {
    const store = createService();
    await store.redis.set('auth:code:login:user@example.com', '123456', 300);

    await expect(store.service.login('user@example.com', '123456')).rejects.toThrow(
      new BadRequestException('该邮箱尚未注册，请先注册'),
    );
    expect(store.users.create).not.toHaveBeenCalled();
  });

  it('registers with a verified code and stores only a password hash', async () => {
    const store = createService();
    await store.redis.set('auth:code:register:user@example.com', '123456', 300);

    const result = await store.service.register({
      email: ' User@Example.COM ',
      code: '123456',
      password: 'Password1',
      confirmPassword: 'Password1',
      nickname: ' Lumina User ',
    });

    expect(result.accessToken).toBe('jwt-token');
    expect(store.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        nickname: 'Lumina User',
        password: expect.any(String),
      }),
    );
    const password = (store.users.create as jest.Mock).mock.calls[0][0].password;
    expect(password).not.toBe('Password1');
    await expect(bcrypt.compare('Password1', password)).resolves.toBe(true);
  });

  it('rejects registration when passwords do not match', async () => {
    const store = createService();

    await expect(
      store.service.register({
        email: 'user@example.com',
        code: '123456',
        password: 'Password1',
        confirmPassword: 'Password2',
      }),
    ).rejects.toThrow(new BadRequestException('两次输入的密码不一致'));
    expect(store.users.create).not.toHaveBeenCalled();
  });

  it('supports password login for registered password users', async () => {
    const password = await bcrypt.hash('Password1', 4);
    const store = createService(createUser({ password }));

    await expect(store.service.passwordLogin('USER@example.com', 'Password1')).resolves.toEqual(
      expect.objectContaining({ accessToken: 'jwt-token' }),
    );
    await expect(store.service.passwordLogin('user@example.com', 'wrong-password')).rejects.toThrow(
      new UnauthorizedException('邮箱或密码错误'),
    );
  });
});
