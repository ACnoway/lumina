import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export const IMAGE_QUEUE_PENDING_KEY = 'lumina:image:queue:pending';
export const IMAGE_QUEUE_PROCESSING_KEY = 'lumina:image:queue:processing';

@Injectable()
export class ImageQueueService {
  constructor(private readonly redisService: RedisService) {}

  async enqueue(taskId: string): Promise<void> {
    await this.redisService.lPush(IMAGE_QUEUE_PENDING_KEY, taskId);
  }

  /**
   * 原子地领取一个任务。领取后的 taskId 留在 processing 列表，直至 ack，
   * 因此 worker 意外退出时仍可由数据库状态恢复。
   */
  async take(timeoutSeconds: number): Promise<string | null> {
    return this.redisService.brPopLPush(
      IMAGE_QUEUE_PENDING_KEY,
      IMAGE_QUEUE_PROCESSING_KEY,
      timeoutSeconds,
    );
  }

  async acknowledge(taskId: string): Promise<void> {
    await this.redisService.lRemAll(IMAGE_QUEUE_PROCESSING_KEY, taskId);
  }
}
