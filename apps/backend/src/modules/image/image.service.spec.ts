import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from '../chat/adapters/adapter-factory';
import { MinioService } from '../../minio/minio.service';
import { ImageQueueService } from './image-queue.service';
import { ImageService } from './image.service';

const imageModel = {
  id: 'model-1',
  name: 'image-model',
  type: 'IMAGE',
  isActive: true,
  pricing: { perImage: 0.5 },
};

const queuedTask = {
  id: 'task-1',
  userId: 'user-1',
  prompt: 'a blue house',
  originalPrompt: null,
  negativePrompt: null,
  model: 'image-model',
  provider: '',
  status: 'PENDING',
  parameters: {
    aspectRatio: '1:1',
    perImagePrice: 0.5,
    retryCount: 0,
  },
};

function createService() {
  const prisma = {
    imageGeneration: {
      create: jest.fn().mockResolvedValue(queuedTask),
      findUnique: jest.fn().mockResolvedValue(queuedTask),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const wallet = {
    preDeduct: jest.fn(),
    refund: jest.fn(),
    settle: jest.fn(),
  };
  const providers = {
    getPlatformModelByName: jest.fn().mockResolvedValue(imageModel),
    resolveUpstream: jest.fn(),
  };
  const queue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    take: jest.fn(),
    acknowledge: jest.fn(),
  };

  const service = new ImageService(
    prisma as unknown as PrismaService,
    wallet as unknown as WalletService,
    providers as unknown as ProvidersService,
    {} as AdapterFactory,
    {} as MinioService,
    {} as ConfigService,
    queue as unknown as ImageQueueService,
  );

  return { service, prisma, wallet, providers, queue };
}

describe('ImageService durable queue integration', () => {
  it('stores a pricing snapshot and enqueues only after the task has been created', async () => {
    const { service, prisma, queue } = createService();

    await expect(
      service.createImageTask('user-1', {
        prompt: 'a blue house',
        model: 'image-model',
        aspectRatio: '16:9',
      }),
    ).resolves.toEqual(queuedTask);

    expect(prisma.imageGeneration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          parameters: {
            aspectRatio: '16:9',
            perImagePrice: 0.5,
            retryCount: 0,
          },
        }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('task-1');
  });

  it('does not process a duplicate queue message that cannot claim the task', async () => {
    const { service, prisma, wallet, providers } = createService();
    prisma.imageGeneration.updateMany.mockResolvedValue({ count: 0 });

    await service.processQueuedTask('task-1');

    expect(wallet.preDeduct).not.toHaveBeenCalled();
    expect(providers.resolveUpstream).not.toHaveBeenCalled();
  });

  it('returns a failed pre-deduction to PENDING and enqueues one bounded retry', async () => {
    const { service, prisma, wallet, queue } = createService();
    wallet.preDeduct.mockRejectedValue(new Error('余额不足'));

    await service.processQueuedTask('task-1');

    expect(prisma.imageGeneration.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          parameters: expect.objectContaining({ retryCount: 1 }),
        }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('task-1');
  });
});
