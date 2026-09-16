import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProvidersService } from './providers.service';

describe('ProvidersService platform model visibility', () => {
  it('only exposes active models to regular callers but lets administrators include disabled models', async () => {
    const platformModel = { findMany: jest.fn().mockResolvedValue([]) };
    const service = new ProvidersService(
      { platformModel } as unknown as PrismaService,
      {} as RedisService,
      {
        get: jest.fn((_: string, defaultValue: number) => defaultValue),
      } as unknown as ConfigService,
    );

    await service.getPlatformModels();
    expect(platformModel.findMany).toHaveBeenLastCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    await service.getPlatformModels('CHAT', true);
    expect(platformModel.findMany).toHaveBeenLastCalledWith({
      where: { type: 'CHAT' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
