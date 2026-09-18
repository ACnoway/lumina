import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.client = createClient({
      url: redisUrl,
      password: redisPassword || undefined,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.disconnect();
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setEx(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * 原子地设置一个仅在不存在时生效的 key。
   */
  async setNX(key: string, value: string, ttl?: number): Promise<boolean> {
    const result = await this.client.set(key, value, {
      NX: true,
      ...(ttl ? { EX: ttl } : {}),
    });

    return result === 'OK';
  }

  /**
   * 仅当 key 仍然属于当前持有者时释放锁，避免误删其他请求的新锁。
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const result = await this.client.eval(
      `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        end
        return 0
      `,
      { keys: [key], arguments: [token] },
    );

    return result === 1;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  async hSet(key: string, field: string, value: string): Promise<void> {
    await this.client.hSet(key, field, value);
  }

  async hDel(key: string, field: string): Promise<void> {
    await this.client.hDel(key, field);
  }

  /**
   * 原子写入预扣记录及其用户索引。
   */
  async setPreDeduct(
    redisKey: string,
    indexKey: string,
    field: string,
    value: string,
    ttl: number,
  ): Promise<void> {
    await this.client
      .multi()
      .set(redisKey, value, { EX: ttl })
      .hSet(indexKey, field, value)
      .expire(indexKey, ttl)
      .exec();
  }

  /**
   * 原子删除预扣记录及其用户索引。
   */
  async removePreDeduct(redisKey: string, indexKey: string, field: string): Promise<void> {
    await this.client.multi().del(redisKey).hDel(indexKey, field).exec();
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * 原子校验并消费验证码。
   * 返回 1 表示匹配并删除，-1 表示验证码存在但不匹配，0 表示不存在或已过期。
   */
  async consumeVerificationCode(
    key: string,
    expected: string,
  ): Promise<'matched' | 'mismatch' | 'missing'> {
    const result = await this.client.eval(
      `
        local stored = redis.call('get', KEYS[1])
        if not stored then
          return 0
        end

        redis.call('del', KEYS[1])
        if stored == ARGV[1] then
          return 1
        end

        return -1
      `,
      { keys: [key], arguments: [expected] },
    );

    if (result === 1) return 'matched';
    if (result === -1) return 'mismatch';
    return 'missing';
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * 原子递增计数器
   * @param key 计数器 key
   * @param ttl 首次创建时的过期时间（秒）
   * @returns 递增后的值
   */
  async incr(key: string, ttl?: number): Promise<number> {
    const value = await this.client.incr(key);

    // 仅在首次创建时设置过期时间
    if (value === 1 && ttl) {
      await this.client.expire(key, ttl);
    }

    return value;
  }

  /**
   * 使用 Redis ZSET + Lua 原子执行一分钟滑动窗口限流。
   * 返回 true 表示当前请求被限流，false 表示请求已占用一个配额。
   */
  async isRateLimited(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
    const windowMilliseconds = windowSeconds * 1000;
    const member = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.client.eval(
      `
        local server_time = redis.call('TIME')
        local now = tonumber(server_time[1]) * 1000 + math.floor(tonumber(server_time[2]) / 1000)
        local window_start = now - tonumber(ARGV[1])
        local request_limit = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])

        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', window_start)
        local count = redis.call('ZCARD', KEYS[1])
        if count >= request_limit then
          redis.call('EXPIRE', KEYS[1], ttl)
          return 0
        end

        redis.call('ZADD', KEYS[1], now, ARGV[4])
        redis.call('EXPIRE', KEYS[1], ttl)
        return 1
      `,
      {
        keys: [key],
        arguments: [String(windowMilliseconds), String(limit), String(windowSeconds), member],
      },
    );

    return result !== 1;
  }

  async lPush(key: string, value: string): Promise<number> {
    return this.client.lPush(key, value);
  }

  /**
   * 原子地从待处理列表领取一个任务，并放入处理中列表。
   * 返回 null 表示在 timeout 秒内没有新任务。
   */
  async brPopLPush(source: string, destination: string, timeout: number): Promise<string | null> {
    return this.client.brPopLPush(source, destination, timeout);
  }

  /**
   * 从列表中移除某任务的所有重复记录。
   */
  async lRemAll(key: string, value: string): Promise<number> {
    return this.client.lRem(key, 0, value);
  }
}
