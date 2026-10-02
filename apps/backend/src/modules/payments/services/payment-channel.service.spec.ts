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
    },
  };
  const adapter = {
    getMetadata: jest.fn().mockReturnValue({
      methods: ['ALIPAY'],
      scenes: ['WEB'],
    }),
  };
  const registry = { get: jest.fn().mockReturnValue(adapter) };
  const crypto = { decrypt: jest.fn().mockReturnValue({ merchant: 'test' }) };
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
});
