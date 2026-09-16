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
