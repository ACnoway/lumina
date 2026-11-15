import 'reflect-metadata';
import { PaymentChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentAdapterRegistry } from '../core/payment-adapter.registry';
import { PaymentErrorCode } from '../core/payment.errors';
import { PaymentConfigCryptoService } from './payment-config-crypto.service';
import { PaymentChannelService } from './payment-channel.service';

function createService() {
  const prisma = {
    paymentChannel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentChannelConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma)),
  };
  const adapter = {
    getMetadata: jest.fn().mockReturnValue({
      methods: ['ALIPAY'],
      scenes: ['WEB'],
    }),
    validateConfig: jest.fn().mockResolvedValue(undefined),
    getPublicConfig: jest.fn().mockReturnValue({}),
  };
  const registry = { get: jest.fn().mockReturnValue(adapter) };
  const crypto = {
    decrypt: jest.fn((value: string) => value?.startsWith('encrypted:')
      ? JSON.parse(value.slice('encrypted:'.length))
      : { merchant: 'test' }),
    encrypt: jest.fn((value: Record<string, unknown>) => `encrypted:${JSON.stringify(value)}`),
  };
  const service = new PaymentChannelService(
    prisma as unknown as PrismaService,
    registry as unknown as PaymentAdapterRegistry,
    crypto as unknown as PaymentConfigCryptoService,
  );
  return { service, prisma, adapter, crypto };
}

describe('PaymentChannelService', () => {
  it('selects the first active channel matching the payment method', async () => {
    const { service, prisma, adapter, crypto } = createService();
    const first = { id: 'channel-1', type: 'ALIPAY', isActive: true } as PaymentChannel;
    prisma.paymentChannel.findMany.mockResolvedValue([first]);

    await expect(service.getUsableChannelForMethod('ALIPAY')).resolves.toEqual({
      channel: first,
      adapter,
      config: { merchant: 'test' },
    });
    expect(prisma.paymentChannel.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    expect(crypto.decrypt).toHaveBeenCalledWith(first.configEncrypted);
  });

  it('reports when no active channel supports the selected payment method', async () => {
    const { service, prisma } = createService();
    prisma.paymentChannel.findMany.mockResolvedValue([]);

    await expect(service.getUsableChannelForMethod('WECHAT')).rejects.toMatchObject({
      code: PaymentErrorCode.CHANNEL_NOT_FOUND,
    });
  });

  it('stores the encrypted configuration as version one in the create transaction', async () => {
    const { service, prisma, adapter, crypto } = createService();
    const channel = {
      id: 'channel-created',
      name: '支付宝主通道',
      type: 'ALIPAY',
      isActive: true,
      configVersion: 1,
      configEncrypted: 'encrypted:{"merchant":"new"}',
      publicConfig: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PaymentChannel;
    adapter.getPublicConfig = jest.fn().mockReturnValue({ appId: 'masked' });
    prisma.paymentChannel.create.mockResolvedValue(channel);

    await service.create({
      name: '支付宝主通道',
      type: 'ALIPAY',
      config: { merchant: 'new' },
    });

    expect(crypto.encrypt).toHaveBeenCalledWith({ merchant: 'new' });
    expect(prisma.paymentChannelConfig.create).toHaveBeenCalledWith({
      data: {
        channelId: channel.id,
        version: 1,
        configEncrypted: 'encrypted:{"merchant":"new"}',
      },
    });
  });

  it('keeps each order configuration version available after channel updates', async () => {
    const { service, prisma, adapter, crypto } = createService();
    const original = {
      id: 'channel-1',
      name: '支付宝主通道',
      type: 'ALIPAY',
      isActive: true,
      configVersion: 1,
      configEncrypted: 'encrypted:{"merchant":"old"}',
      publicConfig: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PaymentChannel;
    const updated = {
      ...original,
      configVersion: 2,
      configEncrypted: 'encrypted:{"merchant":"new"}',
    } as PaymentChannel;
    prisma.paymentChannel.findUnique
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(updated);
    prisma.paymentChannel.updateMany.mockResolvedValue({ count: 1 });
    prisma.paymentChannelConfig.findMany.mockResolvedValue([
      { channelId: original.id, version: 1, configEncrypted: original.configEncrypted },
    ]);
    adapter.getPublicConfig = jest.fn().mockReturnValue({ appId: 'masked' });

    await service.update(original.id, { config: { merchant: 'new' } });

    expect(prisma.paymentChannel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: original.id, configVersion: 1 },
      data: expect.objectContaining({ configVersion: 2 }),
    }));
    expect(prisma.paymentChannelConfig.create).toHaveBeenCalledWith({
      data: {
        channelId: original.id,
        version: 2,
        configEncrypted: 'encrypted:{"merchant":"new"}',
      },
    });
    expect(crypto.encrypt).toHaveBeenCalledWith({ merchant: 'new' });
  });

  it('returns retained notification configs newest first', async () => {
    const { service, prisma, registry, adapter } = createService();
    const channel = {
      id: 'channel-1',
      type: 'EPAY',
      configVersion: 2,
      configEncrypted: 'encrypted-current',
    } as PaymentChannel;
    prisma.paymentChannel.findUnique.mockResolvedValue(channel);
    prisma.paymentChannelConfig.findMany.mockResolvedValue([
      { version: 2, configEncrypted: 'encrypted-new' },
      { version: 1, configEncrypted: 'encrypted-old' },
    ]);

    await expect(service.getNotificationCandidates(channel.id)).resolves.toEqual([
      expect.objectContaining({ channel, adapter, version: 2, config: { merchant: 'test' } }),
      expect.objectContaining({ channel, adapter, version: 1, config: { merchant: 'test' } }),
    ]);
    expect(registry.get).toHaveBeenCalledWith('EPAY');
  });
});
