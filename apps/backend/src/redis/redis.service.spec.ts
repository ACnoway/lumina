import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService sliding-window rate limit', () => {
  function createService() {
    const client = { eval: jest.fn() };
    const service = new RedisService({} as ConfigService);
    (service as any).client = client;
    return { service, client };
  }

  it('accepts a request when the atomic script returns allowed', async () => {
    const { service, client } = createService();
    client.eval.mockResolvedValue(1);

    await expect(service.isRateLimited('ratelimit:provider:upstream', 2, 60)).resolves.toBe(false);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZREMRANGEBYSCORE'"),
      expect.objectContaining({
        keys: ['ratelimit:provider:upstream'],
        arguments: expect.arrayContaining(['60000', '2', '60']),
      }),
    );
  });

  it('reports a request as limited when the atomic script returns rejected', async () => {
    const { service, client } = createService();
    client.eval.mockResolvedValue(0);

    await expect(service.isRateLimited('ratelimit:provider:upstream', 1, 60)).resolves.toBe(true);
  });
});
