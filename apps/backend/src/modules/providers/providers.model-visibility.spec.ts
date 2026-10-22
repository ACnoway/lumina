import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProvidersService } from './providers.service';

describe('ProvidersService platform model visibility', () => {
  it('defaults reference images off and limits the capability to IMAGE models including type changes', async () => {
    const platformModel = {
      findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(),
    };
    const service = new ProvidersService(
      { platformModel } as unknown as PrismaService,
      {} as RedisService,
      { get: jest.fn((_: string, defaultValue: number) => defaultValue) } as unknown as ConfigService,
    );
    await service.createPlatformModel({ name: 'image', displayName: 'Image', type: 'IMAGE', pricing: { perImage: 1 } });
    expect(platformModel.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ supportsReferenceImage: false }) });
    await service.createPlatformModel({ name: 'chat', displayName: 'Chat', type: 'CHAT', pricing: { input: 1, output: 1 }, supportsReferenceImage: true });
    expect(platformModel.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ supportsReferenceImage: false }) });
    platformModel.findUnique.mockResolvedValue({ id: 'image-1', name: 'image', type: 'IMAGE', pricing: { perImage: 1 }, supportsReferenceImage: false });
    await service.updatePlatformModel('image-1', { supportsReferenceImage: true });
    expect(platformModel.update).toHaveBeenLastCalledWith({ where: { id: 'image-1' }, data: { supportsReferenceImage: true } });
    await service.updatePlatformModel('image-1', { type: 'CHAT', pricing: { input: 1, output: 1 }, supportsReferenceImage: true });
    expect(platformModel.update).toHaveBeenLastCalledWith({ where: { id: 'image-1' }, data: expect.objectContaining({ supportsReferenceImage: false }) });
  });

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
