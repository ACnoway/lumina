import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService administrator bootstrap', () => {
  it('creates the configured administrator with an ADMIN role and hashed password', async () => {
    const userCreate = jest.fn().mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: userCreate,
      },
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          ADMIN_EMAIL: ' Admin@Example.COM ',
          ADMIN_PASSWORD: 'initial-secret',
          INITIAL_BALANCE: '10.00',
        };
        return values[key] ?? fallback;
      }),
    } as unknown as ConfigService;

    const service = new UsersService(prisma as unknown as PrismaService, config);
    await service.onModuleInit();

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@example.com',
          role: 'ADMIN',
        }),
      }),
    );
    const [{ data }] = userCreate.mock.calls[0];
    await expect(bcrypt.compare('initial-secret', data.password)).resolves.toBe(true);
  });

  it('repairs an existing configured user to ADMIN without overwriting the password', async () => {
    const userUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'admin@example.com',
          role: 'USER',
        }),
        update: userUpdate,
      },
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'ADMIN_EMAIL' ? 'admin@example.com' : fallback,
      ),
    } as unknown as ConfigService;

    const service = new UsersService(prisma as unknown as PrismaService, config);
    await service.onModuleInit();

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'ADMIN' },
    });
  });

  it('skips bootstrap when ADMIN_EMAIL is not configured', async () => {
    const findUnique = jest.fn();
    const prisma = { user: { findUnique } };
    const config = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService;

    const service = new UsersService(prisma as unknown as PrismaService, config);
    await service.onModuleInit();

    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('UsersService password changes', () => {
  function createService(user: unknown, updateMany = jest.fn().mockResolvedValue({ count: 1 })) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        updateMany,
      },
    };
    const config = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService;

    return {
      service: new UsersService(prisma as unknown as PrismaService, config),
      updateMany,
    };
  }

  it('verifies the current password and stores only a new hash', async () => {
    const currentHash = await bcrypt.hash('OldPassword1', 4);
    const { service, updateMany } = createService({
      id: 'user-1',
      password: currentHash,
      status: 'ACTIVE',
    });

    await service.changePassword('user-1', 'OldPassword1', 'NewPassword2', 'NewPassword2');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        password: currentHash,
        status: 'ACTIVE',
      },
      data: { password: expect.any(String) },
    });
    const [{ data }] = updateMany.mock.calls[0];
    await expect(bcrypt.compare('NewPassword2', data.password)).resolves.toBe(true);
    expect(data.password).not.toBe(currentHash);
  });

  it('rejects an incorrect current password without updating the account', async () => {
    const currentHash = await bcrypt.hash('OldPassword1', 4);
    const { service, updateMany } = createService({
      id: 'user-1',
      password: currentHash,
      status: 'ACTIVE',
    });

    await expect(
      service.changePassword('user-1', 'WrongPassword1', 'NewPassword2', 'NewPassword2'),
    ).rejects.toThrow('当前密码错误');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects unsafe password changes', async () => {
    const currentHash = await bcrypt.hash('OldPassword1', 4);
    const { service } = createService({
      id: 'user-1',
      password: currentHash,
      status: 'ACTIVE',
    });

    await expect(
      service.changePassword('user-1', 'OldPassword1', 'NewPassword2', 'Different3'),
    ).rejects.toThrow('两次输入的新密码不一致');
    await expect(
      service.changePassword('user-1', 'OldPassword1', 'OldPassword1', 'OldPassword1'),
    ).rejects.toThrow('新密码不能与当前密码相同');
  });

  it('does not allow password changes for accounts without a password or inactive accounts', async () => {
    const noPassword = createService({ id: 'user-1', password: null, status: 'ACTIVE' });
    await expect(
      noPassword.service.changePassword('user-1', 'OldPassword1', 'NewPassword2', 'NewPassword2'),
    ).rejects.toThrow('当前账号尚未设置密码');

    const suspended = createService({
      id: 'user-1',
      password: await bcrypt.hash('OldPassword1', 4),
      status: 'SUSPENDED',
    });
    await expect(
      suspended.service.changePassword('user-1', 'OldPassword1', 'NewPassword2', 'NewPassword2'),
    ).rejects.toThrow('当前账号不可执行此操作');
  });

  it('rejects a concurrent update if the password changed after verification', async () => {
    const currentHash = await bcrypt.hash('OldPassword1', 4);
    const { service, updateMany } = createService(
      { id: 'user-1', password: currentHash, status: 'ACTIVE' },
      jest.fn().mockResolvedValue({ count: 0 }),
    );

    await expect(
      service.changePassword('user-1', 'OldPassword1', 'NewPassword2', 'NewPassword2'),
    ).rejects.toThrow('账号状态已变化');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
