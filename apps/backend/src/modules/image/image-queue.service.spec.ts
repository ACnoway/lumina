import 'reflect-metadata';
import { RedisService } from '../../redis/redis.service';
import {
  IMAGE_QUEUE_PENDING_KEY,
  IMAGE_QUEUE_PROCESSING_KEY,
  ImageQueueService,
} from './image-queue.service';

describe('ImageQueueService', () => {
  const redis = {
    lPush: jest.fn(),
    brPopLPush: jest.fn(),
    lRemAll: jest.fn(),
  };
  const service = new ImageQueueService(redis as unknown as RedisService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueues a task into the persistent pending list', async () => {
    await service.enqueue('task-1');

    expect(redis.lPush).toHaveBeenCalledWith(IMAGE_QUEUE_PENDING_KEY, 'task-1');
  });

  it('atomically moves a task from pending to processing when claimed', async () => {
    redis.brPopLPush.mockResolvedValue('task-1');

    await expect(service.take(1)).resolves.toBe('task-1');
    expect(redis.brPopLPush).toHaveBeenCalledWith(
      IMAGE_QUEUE_PENDING_KEY,
      IMAGE_QUEUE_PROCESSING_KEY,
      1,
    );
  });

  it('removes every duplicate processing entry when acknowledged', async () => {
    await service.acknowledge('task-1');

    expect(redis.lRemAll).toHaveBeenCalledWith(IMAGE_QUEUE_PROCESSING_KEY, 'task-1');
  });
});
