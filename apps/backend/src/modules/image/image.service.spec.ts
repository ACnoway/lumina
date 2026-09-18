import 'reflect-metadata';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from '../chat/adapters/adapter-factory';
import { MinioService } from '../../minio/minio.service';
import { ImageQueueService } from './image-queue.service';
import { ImageService } from './image.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

const imageModel = {
  id: 'model-1',
  name: 'image-model',
  type: 'IMAGE',
  isActive: true,
  pricing: { perImage: 0.5 },
};

const promptOptimizerModel = {
  id: 'model-chat-1',
  name: 'chat-model',
  type: 'CHAT',
  isActive: true,
  pricing: { input: 0.01, output: 0.02 },
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
    imageCount: 1,
    retryCount: 0,
  },
  images: [],
};

function createService() {
  const imageRecords = [
    {
      id: 'image-1',
      generationId: 'task-1',
      sequence: 0,
      status: 'PENDING',
      retryCount: 0,
      width: null,
      height: null,
      imageUrl: null,
      imageKey: null,
      cost: null,
      errorMessage: null,
    },
  ];
  const imageGenerationImage = {
    findMany: jest.fn().mockImplementation(async () => imageRecords),
    createMany: jest.fn().mockImplementation(async ({ data }) => {
      for (const item of data) {
        imageRecords.push({
          id: `image-${imageRecords.length + 1}`,
          generationId: item.generationId,
          sequence: item.sequence,
          status: 'PENDING',
          retryCount: 0,
          width: null,
          height: null,
          imageUrl: null,
          imageKey: null,
          cost: null,
          errorMessage: null,
        });
      }
    }),
    updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
      const matches = imageRecords.filter((record) => {
        if (where.id && record.id !== where.id) return false;
        if (where.generationId && record.generationId !== where.generationId) return false;
        if (where.status?.in && !where.status.in.includes(record.status)) return false;
        return true;
      });
      matches.forEach((record) => Object.assign(record, data));
      return { count: matches.length };
    }),
    update: jest.fn().mockImplementation(async ({ where, data }) => {
      const record = imageRecords.find((item) => item.id === where.id);
      if (record) Object.assign(record, data);
      return record;
    }),
  };
  const prisma = {
    imageGeneration: {
      create: jest.fn().mockResolvedValue(queuedTask),
      findUnique: jest.fn().mockResolvedValue(queuedTask),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    imageGenerationImage,
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
  const adapter = { chat: jest.fn() };
  const adapterFactory = {
    createAdapter: jest.fn().mockReturnValue(adapter),
  };
  const settings = {
    getPromptOptimizerModel: jest.fn().mockResolvedValue(null),
  };
  const minio = {
    upload: jest.fn(),
    getPresignedUrl: jest.fn().mockResolvedValue('https://minio.test/image.png'),
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
    adapterFactory as unknown as AdapterFactory,
    minio as unknown as MinioService,
    queue as unknown as ImageQueueService,
    settings as unknown as SettingsService,
  );

  return { service, prisma, wallet, providers, minio, queue, adapter, settings, imageRecords };
}

describe('ImageService durable queue integration', () => {
  it('uses the configured existing chat model to optimize a prompt and settle actual usage', async () => {
    const { service, wallet, providers, adapter, settings } = createService();
    const recordResult = jest.fn().mockResolvedValue(undefined);
    settings.getPromptOptimizerModel.mockResolvedValue(promptOptimizerModel);
    providers.resolveUpstream.mockResolvedValue({
      provider: {
        name: 'chat-provider',
        config: { apiKey: 'test-key' },
        apiFormat: 'openai_compatible',
      },
      upstreamModel: { upstreamModelId: 'upstream-chat-model' },
      recordResult,
    });
    adapter.chat.mockResolvedValue({
      content: 'expanded prompt',
      inputTokens: 10,
      outputTokens: 20,
    });

    const result = await service.optimizePrompt('user-1', '一只猫');
    const idempotencyKey = wallet.preDeduct.mock.calls[0][2];

    expect(result).toEqual({ optimizedPrompt: 'expanded prompt', cost: 0.0005 });
    expect(providers.resolveUpstream).toHaveBeenCalledWith('chat-model');
    expect(adapter.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'upstream-chat-model',
        stream: false,
        maxTokens: 300,
      }),
    );
    expect(wallet.preDeduct).toHaveBeenCalledWith(
      'user-1',
      0.01,
      expect.stringMatching(/^prompt-opt:user-1:/),
    );
    expect(wallet.settle).toHaveBeenCalledWith(
      'user-1',
      0.0005,
      idempotencyKey,
      '提示词优化: chat-model',
      { inputTokens: 10, outputTokens: 20 },
    );
    expect(recordResult).toHaveBeenCalledWith(true);
  });

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
            imageCount: 1,
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

    expect(prisma.imageGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', cost: 0 }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('task-1');
  });

  it('uses the minimum charge consistently when an image price is zero', async () => {
    const { service, prisma, wallet, providers } = createService();
    const recordResult = jest.fn().mockResolvedValue(undefined);
    providers.resolveUpstream.mockResolvedValue({
      provider: { name: 'provider-1', config: {}, apiFormat: 'openai_image' },
      upstreamModel: { upstreamModelId: 'upstream-image' },
      recordResult,
    });
    prisma.imageGeneration.update.mockResolvedValue({});
    (service as any).callOpenAIImage = jest.fn().mockResolvedValue({
      imageBuffer: Buffer.from('image'),
    });

    await (service as any).processImageTask(
      'user-1',
      'task-1',
      'a blue house',
      undefined,
      'image-model',
      '1:1',
      0,
      { retryCount: 0 },
    );

    expect(wallet.preDeduct).toHaveBeenCalledWith('user-1', 0.01, 'image:task-1:0');
    expect(wallet.settle).toHaveBeenCalledWith(
      'user-1',
      0.01,
      'image:task-1:0',
      '生图: image-model',
      { taskId: 'task-1', imageId: 'image-1', sequence: 0, model: 'image-model' },
    );
    expect((service as any).callOpenAIImage).toHaveBeenCalledWith(
      {},
      'upstream-image',
      'a blue house',
      { width: 1024, height: 1024 },
      'image:task-1:0',
    );
    expect(prisma.imageGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS', cost: 0.01 }),
      }),
    );
    expect(recordResult).toHaveBeenCalledWith(true);
    expect(recordResult).not.toHaveBeenCalledWith(false);
  });

  it('passes the stable task key to OpenAI and Stability image requests', async () => {
    const { service } = createService();
    const imageResponse = {
      data: { data: [{ b64_json: Buffer.from('image').toString('base64') }] },
    };
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValueOnce(imageResponse as any)
      .mockResolvedValueOnce({ data: Buffer.from('image') } as any);

    await (service as any).callOpenAIImage(
      { apiKey: 'openai-key', baseUrl: 'https://openai.test/v1' },
      'openai-image',
      'a blue house',
      { width: 1024, height: 1024 },
      'image:task-1',
    );
    await (service as any).callStabilityImage(
      { apiKey: 'stability-key', baseUrl: 'https://stability.test' },
      'stable-image',
      'a blue house',
      undefined,
      { width: 1024, height: 1024 },
      'image:task-1',
    );

    expect(axiosPost).toHaveBeenNthCalledWith(
      1,
      'https://openai.test/v1/images/generations',
      expect.objectContaining({ model: 'openai-image' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'image:task-1',
        }),
      }),
    );
    expect(axiosPost).toHaveBeenNthCalledWith(
      2,
      'https://stability.test/v2beta/stable-image/generate/stable-image',
      expect.any(FormData),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'image:task-1',
        }),
      }),
    );
  });

  it('settles each successful image separately and only charges completed images', async () => {
    const { service, prisma, wallet, providers, imageRecords, queue } = createService();
    imageRecords.push({
      id: 'image-2',
      generationId: 'task-1',
      sequence: 1,
      status: 'PENDING',
      retryCount: 0,
      width: null,
      height: null,
      imageUrl: null,
      imageKey: null,
      cost: null,
      errorMessage: null,
    });
    const recordResult = jest.fn().mockResolvedValue(undefined);
    providers.resolveUpstream.mockResolvedValue({
      provider: { name: 'provider-1', config: {}, apiFormat: 'openai_image' },
      upstreamModel: { upstreamModelId: 'upstream-image' },
      recordResult,
    });
    (service as any).callOpenAIImage = jest
      .fn()
      .mockResolvedValueOnce({ imageBuffer: Buffer.from('image-1') })
      .mockRejectedValueOnce(new Error('上游拒绝第二张图片'));

    await (service as any).processImageTask(
      'user-1',
      'task-1',
      'a blue house',
      undefined,
      'image-model',
      '1:1',
      0.5,
      { retryCount: 0, imageCount: 2 },
    );

    expect(wallet.preDeduct).toHaveBeenNthCalledWith(1, 'user-1', 0.5, 'image:task-1:0');
    expect(wallet.preDeduct).toHaveBeenNthCalledWith(2, 'user-1', 0.5, 'image:task-1:1');
    expect(wallet.settle).toHaveBeenCalledTimes(1);
    expect(wallet.settle).toHaveBeenCalledWith(
      'user-1',
      0.5,
      'image:task-1:0',
      '生图: image-model',
      { taskId: 'task-1', imageId: 'image-1', sequence: 0, model: 'image-model' },
    );
    expect(wallet.refund).toHaveBeenCalledWith(
      'user-1',
      'image:task-1:1',
      expect.stringContaining('上游拒绝第二张图片'),
    );
    expect(prisma.imageGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', cost: 0.5 }),
      }),
    );
    expect(imageRecords.find((image) => image.id === 'image-2')).toMatchObject({
      status: 'PENDING',
      retryCount: 1,
    });
    expect(queue.enqueue).toHaveBeenCalledWith('task-1');
  });

  it('retries each failed image independently up to three times and preserves upstream 400 details', async () => {
    const { service, prisma, wallet, providers, queue, imageRecords } = createService();
    const recordResult = jest.fn().mockResolvedValue(undefined);
    providers.resolveUpstream.mockResolvedValue({
      provider: { name: 'provider-1', config: {}, apiFormat: 'openai_image' },
      upstreamModel: { upstreamModelId: 'upstream-image' },
      recordResult,
    });
    const upstreamError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          message:
            '非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。',
        },
      },
    });
    (service as any).callOpenAIImage = jest.fn().mockRejectedValue(upstreamError);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await (service as any).processImageTask(
        'user-1',
        'task-1',
        'a blue house',
        undefined,
        'image-model',
        '1:1',
        0.5,
        { retryCount: 0, imageCount: 1 },
      );
    }

    expect((service as any).callOpenAIImage).toHaveBeenCalledTimes(4);
    expect(wallet.preDeduct).toHaveBeenCalledTimes(4);
    expect(wallet.refund).toHaveBeenCalledTimes(4);
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect(imageRecords[0]).toMatchObject({ status: 'FAILED', retryCount: 3 });
    expect(imageRecords[0].errorMessage).toContain(
      'status_code=400, 非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。',
    );
    expect(prisma.imageGeneration.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', cost: 0 }),
      }),
    );
  });

  it('does not mark the provider as failed when settlement fails after upstream success', async () => {
    const { service, prisma, wallet, providers } = createService();
    const recordResult = jest.fn().mockResolvedValue(undefined);
    providers.resolveUpstream.mockResolvedValue({
      provider: { name: 'provider-1', config: {}, apiFormat: 'openai_image' },
      upstreamModel: { upstreamModelId: 'upstream-image' },
      recordResult,
    });
    wallet.settle.mockRejectedValue(new Error('结算失败'));
    prisma.imageGeneration.update.mockResolvedValue({});
    (service as any).callOpenAIImage = jest.fn().mockResolvedValue({
      imageBuffer: Buffer.from('image'),
    });

    await (service as any).processImageTask(
      'user-1',
      'task-1',
      'a blue house',
      undefined,
      'image-model',
      '1:1',
      0.5,
      { retryCount: 0 },
    );

    expect(wallet.refund).toHaveBeenCalledWith(
      'user-1',
      'image:task-1:0',
      '生图失败: 阶段=钱包结算; Error: 结算失败',
    );
    expect(recordResult).not.toHaveBeenCalledWith(false);
    expect(prisma.imageGeneration.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('keeps the processing stage when MinIO returns an empty error message', async () => {
    const { service, prisma, wallet, providers, minio, queue, imageRecords } = createService();
    const recordResult = jest.fn().mockResolvedValue(undefined);
    providers.resolveUpstream.mockResolvedValue({
      provider: { name: 'provider-1', config: {}, apiFormat: 'openai_image' },
      upstreamModel: { upstreamModelId: 'upstream-image' },
      recordResult,
    });
    prisma.imageGeneration.update.mockResolvedValue({});
    (service as any).callOpenAIImage = jest.fn().mockResolvedValue({
      imageBuffer: Buffer.from('image'),
    });
    minio.getPresignedUrl.mockRejectedValue(
      Object.assign(new Error(), { name: 'S3Error', code: 'NotFound' }),
    );

    await (service as any).processImageTask(
      'user-1',
      'task-1',
      'a blue house',
      undefined,
      'image-model',
      '1:1',
      0.5,
      { retryCount: 0 },
    );

    expect(prisma.imageGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          errorMessage: '部分图片生成失败，正在重试',
        }),
      }),
    );
    expect(imageRecords[0]).toMatchObject({ status: 'PENDING', retryCount: 1 });
    expect(imageRecords[0].errorMessage).toContain(
      '阶段=MinIO 生成预签名 URL; S3Error: 未提供错误消息, code=NotFound',
    );
    expect(queue.enqueue).toHaveBeenCalledWith('task-1');
    expect(wallet.refund).toHaveBeenCalledWith(
      'user-1',
      'image:task-1:0',
      '生图失败: 阶段=MinIO 生成预签名 URL; S3Error: 未提供错误消息, code=NotFound',
    );
    expect(recordResult).not.toHaveBeenCalledWith(false);
  });
});
