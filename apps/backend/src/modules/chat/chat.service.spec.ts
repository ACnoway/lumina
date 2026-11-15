import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from './adapters/adapter-factory';
import { ChatService } from './chat.service';
import { ChatRequest, StreamCallbacks } from './adapters/types';

function createService() {
  const prisma = {
    chatSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        title: '新对话',
      }),
    },
    chatMessage: {
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  return {
    service: new ChatService(
      prisma as unknown as PrismaService,
      {} as WalletService,
      {} as ProvidersService,
      {} as AdapterFactory,
      {
        getPresignedUrl: jest.fn().mockResolvedValue('https://storage.example/image'),
        download: jest.fn().mockResolvedValue(Buffer.from('')),
        delete: jest.fn().mockResolvedValue(undefined),
      } as any,
    ),
    prisma,
  };
}

describe('ChatService', () => {
  it('estimates context usage from model metadata without routing an upstream', async () => {
    const prisma = {
      chatSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'session-1', userId: 'user-1', title: 'existing' }),
      },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const providers = {
      getPlatformModelByName: jest.fn().mockResolvedValue({
        type: 'CHAT',
        isActive: true,
        contextWindowTokens: 4096,
        maxTokens: 1500,
        upstreamModels: [
          { maxTokens: 2048, provider: { isActive: true } },
        ],
      }),
      resolveUpstream: jest.fn(),
    };
    const service = new ChatService(prisma as any, {} as any, providers as any, {} as any, {} as any);

    await expect(service.getContextUsage('user-1', 'session-1', 'chat')).resolves.toMatchObject({
      contextWindowTokens: 4096,
      reservedOutputTokens: 2048,
    });
    expect(providers.resolveUpstream).not.toHaveBeenCalled();
  });

  it('reserves the upstream output limit and settles actual usage in per-million units', async () => {
    const userMessage = { id: 'message-1', role: 'USER', content: 'hi', attachments: [] };
    const prisma = {
      chatSession: { findUnique: jest.fn().mockResolvedValue({ id: 'session-1', userId: 'user-1', title: 'existing' }) },
      chatMessage: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(userMessage),
        findMany: jest.fn().mockResolvedValue([userMessage]),
      },
    };
    const wallet = { preDeduct: jest.fn(), settle: jest.fn(), refund: jest.fn() };
    const providers = {
      getPlatformModelByName: jest.fn().mockResolvedValue({ type: 'CHAT', isActive: true, pricing: { input: 0, output: 100 } }),
      resolveUpstream: jest.fn().mockResolvedValue({ provider: { config: {}, apiFormat: 'openai_compatible' }, upstreamModel: { upstreamModelId: 'upstream', maxTokens: 3000 }, recordResult: jest.fn() }),
    };
    const adapter = { chatStream: jest.fn(async (_request: ChatRequest, callbacks: StreamCallbacks) => {
      callbacks.onContent?.('hello');
      callbacks.onDone?.({ inputTokens: 1, outputTokens: 3100, totalTokens: 3101 });
    }) };
    const service = new ChatService(prisma as any, wallet as any, providers as any, { createAdapter: () => adapter } as any, {} as any);
    const response = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn(), destroyed: false };
    await service.sendMessageStream('user-1', { sessionId: 'session-1', model: 'chat', content: 'hi' }, [], response as any);
    expect(wallet.preDeduct).toHaveBeenCalledWith('user-1', 0.3, 'chat:session-1:message-1');
    expect(adapter.chatStream).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 3000 }), expect.anything());
    expect(wallet.settle).toHaveBeenCalledWith('user-1', 0.31, 'chat:session-1:message-1', '聊天: chat', expect.anything());
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"cost":0.31'));
  });

  it('estimates missing stream usage and does not turn a completed charge into a failed response when provider status recording fails', async () => {
    const userMessage = { id: 'message-2', role: 'USER', content: 'hi', attachments: [] };
    const prisma = {
      chatSession: { findUnique: jest.fn().mockResolvedValue({ id: 'session-1', userId: 'user-1', title: 'existing' }) },
      chatMessage: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(userMessage),
        findMany: jest.fn().mockResolvedValue([userMessage]),
      },
    };
    const wallet = { preDeduct: jest.fn(), settle: jest.fn(), refund: jest.fn() };
    const recordResult = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const providers = {
      getPlatformModelByName: jest.fn().mockResolvedValue({
        type: 'CHAT', isActive: true, pricing: { input: 100, output: 100 },
      }),
      resolveUpstream: jest.fn().mockResolvedValue({
        provider: { config: {}, apiFormat: 'openai_compatible' },
        upstreamModel: { upstreamModelId: 'upstream', maxTokens: 3000 },
        recordResult,
      }),
    };
    const adapter = { chatStream: jest.fn(async (_request: ChatRequest, callbacks: StreamCallbacks) => {
      callbacks.onContent?.('hello');
    }) };
    const service = new ChatService(prisma as any, wallet as any, providers as any, { createAdapter: () => adapter } as any, {} as any);
    const response = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn(), destroyed: false };

    await service.sendMessageStream('user-1', { sessionId: 'session-1', model: 'chat', content: 'hi' }, [], response as any);

    expect(wallet.settle).toHaveBeenCalledWith(
      'user-1', expect.any(Number), 'chat:session-1:message-2', '聊天: chat',
      expect.objectContaining({ usageEstimated: true, inputTokens: expect.any(Number), outputTokens: expect.any(Number) }),
    );
    expect(wallet.refund).not.toHaveBeenCalled();
    expect(recordResult).toHaveBeenCalledWith(true);
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"type":"done"'));
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"usageEstimated":true'));
  });

  it('settles content already delivered before a stream error instead of refunding it', async () => {
    const userMessage = { id: 'message-3', role: 'USER', content: 'hi', attachments: [] };
    const prisma = {
      chatSession: { findUnique: jest.fn().mockResolvedValue({ id: 'session-1', userId: 'user-1', title: 'existing' }) },
      chatMessage: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(userMessage),
        findMany: jest.fn().mockResolvedValue([userMessage]),
      },
    };
    const wallet = { preDeduct: jest.fn(), settle: jest.fn(), refund: jest.fn() };
    const recordResult = jest.fn().mockResolvedValue(undefined);
    const providers = {
      getPlatformModelByName: jest.fn().mockResolvedValue({ type: 'CHAT', isActive: true, pricing: { input: 100, output: 100 } }),
      resolveUpstream: jest.fn().mockResolvedValue({
        provider: { config: {}, apiFormat: 'openai_compatible' },
        upstreamModel: { upstreamModelId: 'upstream', maxTokens: 3000 },
        recordResult,
      }),
    };
    const adapter = { chatStream: jest.fn(async (_request: ChatRequest, callbacks: StreamCallbacks) => {
      callbacks.onContent?.('partial answer');
      callbacks.onError?.(new Error('upstream disconnected'));
    }) };
    const service = new ChatService(prisma as any, wallet as any, providers as any, { createAdapter: () => adapter } as any, {} as any);
    const response = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn(), destroyed: false };

    await service.sendMessageStream('user-1', { sessionId: 'session-1', model: 'chat', content: 'hi' }, [], response as any);

    expect(wallet.settle).toHaveBeenCalledTimes(1);
    expect(wallet.refund).not.toHaveBeenCalled();
    expect(recordResult).toHaveBeenCalledWith(false);
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"cost":'));
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"type":"error"'));
  });

  it('serializes Decimal message costs as numbers for the API response', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-09-16T00:00:00.000Z');
    prisma.chatMessage.findMany.mockResolvedValue([
      {
        id: 'message-1',
        role: 'ASSISTANT',
        content: '你好',
        tokens: 12,
        cost: new Decimal('0.0123'),
        createdAt,
        attachments: [],
      },
    ]);

    await expect(service.getMessages('user-1', 'session-1')).resolves.toEqual({
      messages: [
        {
          id: 'message-1',
          role: 'ASSISTANT',
          content: '你好',
          tokens: 12,
          cost: 0.0123,
          createdAt,
          attachments: [],
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
  });
});
