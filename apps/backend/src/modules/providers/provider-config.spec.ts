import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateProviderDto, UpdateProviderDto } from './dto/providers.dto';
import { ProvidersService } from './providers.service';
import { assertValidProviderConfig, getProviderConfigError } from './provider-config';

const validProviderConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  timeout: 30000,
  rateLimit: 60,
};

describe('provider configuration validation', () => {
  it('accepts the structured provider configuration', async () => {
    const errors = await validate(
      plainToInstance(CreateProviderDto, {
        name: 'example-provider',
        apiFormat: 'openai_chat',
        config: validProviderConfig,
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('accepts provider edits without repeating the existing API key', async () => {
    const errors = await validate(
      plainToInstance(UpdateProviderDto, {
        name: 'updated-provider',
        config: {
          baseUrl: 'https://api.example.com/v2',
          timeout: 60000,
          rateLimit: 120,
        },
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    [{ ...validProviderConfig, apiKey: '  ' }],
    [{ ...validProviderConfig, baseUrl: 'ftp://api.example.com' }],
    [{ ...validProviderConfig, timeout: 1.5 }],
    [{ ...validProviderConfig, rateLimit: 0 }],
    [{ ...validProviderConfig, unexpected: true }],
  ])('rejects invalid provider configuration: %j', async (config) => {
    const errors = await validate(
      plainToInstance(CreateProviderDto, {
        name: 'invalid-provider',
        apiFormat: 'openai_chat',
        config,
      }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'config' })]),
    );
  });

  it('returns safe errors and protects direct service callers', async () => {
    expect(getProviderConfigError({ apiKey: 'test', timeout: -1 })).toContain('超时');
    expect(() => assertValidProviderConfig({ apiKey: '' })).toThrow(BadRequestException);

    const provider = {
      findUnique: jest.fn(),
      create: jest.fn(),
    };
    const service = new ProvidersService(
      { provider, platformModel: {} } as unknown as PrismaService,
      {} as RedisService,
      {
        get: jest.fn((_: string, defaultValue: number) => defaultValue),
      } as unknown as ConfigService,
    );

    await expect(
      service.createProvider({
        name: 'invalid-service-provider',
        apiFormat: 'openai_chat',
        config: { apiKey: '' },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(provider.findUnique).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('merges provider edits with the persisted API key', async () => {
    const provider = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'example-provider',
        config: validProviderConfig,
      }),
      update: jest.fn().mockResolvedValue({ id: 'provider-1' }),
    };
    const service = new ProvidersService(
      { provider, platformModel: {} } as unknown as PrismaService,
      {} as RedisService,
      {
        get: jest.fn((_: string, defaultValue: number) => defaultValue),
      } as unknown as ConfigService,
    );

    await service.updateProvider('provider-1', {
      config: {
        baseUrl: 'https://api.example.com/v2',
      },
    });

    expect(provider.update).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      data: {
        config: {
          ...validProviderConfig,
          baseUrl: 'https://api.example.com/v2',
        },
      },
    });
  });
});
