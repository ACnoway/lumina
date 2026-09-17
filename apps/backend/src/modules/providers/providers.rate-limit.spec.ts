import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProvidersService } from './providers.service';

describe('ProvidersService rate limiting', () => {
  function createService(redis: Pick<RedisService, 'isRateLimited'>) {
    return new ProvidersService(
      {} as PrismaService,
      redis as RedisService,
      {
        get: jest.fn((_: string, defaultValue: number) => defaultValue),
      } as unknown as ConfigService,
    );
  }

  it('uses one rolling key per provider upstream instead of minute buckets', async () => {
    const redis = { isRateLimited: jest.fn().mockResolvedValue(false) };
    const service = createService(redis);

    await expect(service.checkRateLimit('provider-1', 'upstream-1', 2)).resolves.toBe(false);

    expect(redis.isRateLimited).toHaveBeenCalledWith('ratelimit:provider-1:upstream-1', 2, 60);
  });

  it('normalizes a positive fractional limit and preserves rejection semantics', async () => {
    const redis = { isRateLimited: jest.fn().mockResolvedValue(true) };
    const service = createService(redis);

    await expect(service.checkRateLimit('provider-1', 'upstream-1', 2.9)).resolves.toBe(true);

    expect(redis.isRateLimited).toHaveBeenCalledWith('ratelimit:provider-1:upstream-1', 2, 60);
  });
});
