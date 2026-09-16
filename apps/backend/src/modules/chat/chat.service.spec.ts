import 'reflect-metadata';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from './adapters/adapter-factory';
import { ChatService } from './chat.service';

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
    ),
    prisma,
  };
}

describe('ChatService', () => {
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
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
  });
});
