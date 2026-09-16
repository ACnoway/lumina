import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreatePlatformModelDto } from './dto/providers.dto';
import { ProvidersService } from './providers.service';
import {
  assertValidPlatformModelPricing,
  getPlatformModelPricingError,
} from './platform-model-pricing';

describe('platform model pricing validation', () => {
  function createService(platformModel: Record<string, jest.Mock>) {
    return new ProvidersService(
      { platformModel } as unknown as PrismaService,
      {} as RedisService,
      {
        get: jest.fn((_: string, defaultValue: number) => defaultValue),
      } as unknown as ConfigService,
    );
  }

  it('accepts the type-specific CHAT and IMAGE shapes', async () => {
    const chatErrors = await validate(
      plainToInstance(CreatePlatformModelDto, {
        name: 'gpt-test',
        displayName: 'GPT Test',
        type: 'CHAT',
        pricing: { input: 0.001, output: 0.002 },
      }),
    );
    const imageErrors = await validate(
      plainToInstance(CreatePlatformModelDto, {
        name: 'image-test',
        displayName: 'Image Test',
        type: 'IMAGE',
        pricing: { perImage: 0.5 },
      }),
    );

    expect(chatErrors).toHaveLength(0);
    expect(imageErrors).toHaveLength(0);
  });

  it.each([
    ['CHAT', { input: 0.001 }],
    ['CHAT', { input: 0.001, output: -0.002 }],
    ['CHAT', { input: 0.001, output: 0.002, perImage: 1 }],
    ['IMAGE', { input: 0.001, output: 0.002 }],
    ['IMAGE', { perImage: '0.5' }],
  ])('rejects invalid %s pricing: %j', async (type, pricing) => {
    const errors = await validate(
      plainToInstance(CreatePlatformModelDto, {
        name: 'invalid-test',
        displayName: 'Invalid Test',
        type,
        pricing,
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'pricing' })]),
    );
  });

  it('keeps the pricing error readable for direct service callers', () => {
    expect(getPlatformModelPricingError('CHAT', { perImage: 1 })).toContain('input 和 output');
    expect(() => assertValidPlatformModelPricing('IMAGE', { input: 1, output: 2 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid pricing before creating a platform model', async () => {
    const platformModel = {
      findUnique: jest.fn(),
      create: jest.fn(),
    };
    const service = createService(platformModel);

    await expect(
      service.createPlatformModel({
        name: 'invalid-service-model',
        displayName: 'Invalid Service Model',
        type: 'CHAT',
        pricing: { perImage: 0.5 },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(platformModel.findUnique).not.toHaveBeenCalled();
    expect(platformModel.create).not.toHaveBeenCalled();
  });

  it('validates merged pricing when changing an existing model type', async () => {
    const platformModel = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'model-1',
        name: 'chat-model',
        type: 'CHAT',
        pricing: { input: 0.001, output: 0.002 },
      }),
      update: jest.fn(),
    };
    const service = createService(platformModel);

    await expect(
      service.updatePlatformModel('model-1', { type: 'IMAGE' }),
    ).rejects.toThrow(BadRequestException);
    expect(platformModel.update).not.toHaveBeenCalled();
  });
});
