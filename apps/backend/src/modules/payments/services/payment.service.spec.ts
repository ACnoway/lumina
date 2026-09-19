import 'reflect-metadata';
import { PaymentChannel, PaymentOrder, PaymentOrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { SettingsService } from '../../settings/settings.service';
import { PaymentChannelError, PaymentErrorCode } from '../core/payment.errors';
import { PaymentService } from './payment.service';

function makeOrder(status: PaymentOrderStatus = PaymentOrderStatus.PENDING): PaymentOrder & { channel: PaymentChannel } {
  const channel = {
    id: 'channel-1',
    name: '测试易支付',
    type: 'EPAY',
  } as PaymentChannel;
  return {
    id: 'payment-order-1',
    orderNo: 'LM202609190000001234',
    userId: 'user-1',
    channelId: channel.id,
    channelType: channel.type,
    paymentMethod: 'ALIPAY',
    scene: 'QR',
    amount: new Decimal('10.00'),
    currency: 'CNY',
    photonAmount: new Decimal('100'),
    photonPerCny: new Decimal('10'),
    subject: '测试充值',
    status,
    providerTradeNo: null,
    paidAmount: null,
    paidAt: null,
    expireAt: new Date(Date.now() + 30 * 60 * 1000),
    clientIp: null,
    idempotencyKey: 'payment-idempotency-1',
    metadata: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    channel,
  };
}

function createService() {
  const prisma = {
    paymentOrder: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentCallbackEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const walletService = { recharge: jest.fn() };
  const settingsService = {};
  const adapter = {
    queryPayment: jest.fn(),
    parseNotification: jest.fn(),
    buildNotificationResponse: jest.fn((success: boolean) => ({ body: success ? 'success' : 'fail' })),
  };
  const channels = { getById: jest.fn().mockResolvedValue({ adapter, config: {} }) };
  const config = { get: jest.fn() };
  const service = new PaymentService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
    settingsService as unknown as SettingsService,
    channels as never,
    config as unknown as ConfigService,
  );
  return { service, prisma, walletService, adapter };
}

describe('PaymentService', () => {
  it('does not credit the wallet for an unpaid query result', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder();
    prisma.paymentOrder.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(order);
    adapter.queryPayment.mockResolvedValue({
      status: 'PENDING',
      providerTradeNo: 'T-unpaid',
      amount: '10.00',
      currency: 'CNY',
    });

    await expect(service.syncOrder(order.userId, order.orderNo)).resolves.toMatchObject({ status: 'PENDING' });
    expect(walletService.recharge).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled();
  });

  it('requires an exact amount and currency before crediting a successful payment', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder();
    prisma.paymentOrder.findFirst.mockResolvedValueOnce(order);
    adapter.queryPayment.mockResolvedValue({
      status: 'SUCCESS',
      providerTradeNo: 'T-wrong-currency',
      amount: '10.00',
      currency: 'USD',
    });

    await expect(service.syncOrder(order.userId, order.orderNo)).rejects.toMatchObject({
      code: PaymentErrorCode.PAYMENT_CURRENCY_MISMATCH,
    } satisfies Partial<PaymentChannelError>);
    expect(walletService.recharge).not.toHaveBeenCalled();
  });

  it('does not revive a closed order from a later successful query', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder(PaymentOrderStatus.CLOSED);
    prisma.paymentOrder.findFirst.mockResolvedValueOnce(order);
    adapter.queryPayment.mockResolvedValue({
      status: 'SUCCESS',
      providerTradeNo: 'T-late-paid',
      amount: '10.00',
      currency: 'CNY',
    });

    await expect(service.syncOrder(order.userId, order.orderNo)).rejects.toMatchObject({
      code: PaymentErrorCode.PAYMENT_ALREADY_CLOSED,
    } satisfies Partial<PaymentChannelError>);
    expect(walletService.recharge).not.toHaveBeenCalled();
  });

  it('credits once for an explicitly confirmed payment', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder();
    prisma.paymentOrder.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, status: PaymentOrderStatus.SUCCEEDED });
    adapter.queryPayment.mockResolvedValue({
      status: 'SUCCESS',
      providerTradeNo: 'T-paid',
      amount: '10.00',
      currency: 'CNY',
      paidAt: new Date(),
    });
    walletService.recharge.mockResolvedValue({});

    await expect(service.syncOrder(order.userId, order.orderNo)).resolves.toMatchObject({
      status: PaymentOrderStatus.SUCCEEDED,
    });
    expect(walletService.recharge).toHaveBeenCalledWith(
      order.userId,
      100,
      `支付充值 ${order.orderNo}`,
      `payment:recharge:${order.orderNo}`,
    );
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: order.id, status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] } },
    }));
  });

  it('does not process a notification when channel signature validation fails', async () => {
    const { service, prisma, walletService, adapter } = createService();
    adapter.parseNotification.mockRejectedValue(new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, 'invalid'));
    adapter.buildNotificationResponse.mockReturnValue({ body: 'fail' });

    await expect(service.processNotification('channel-1', {
      headers: {},
      rawBody: Buffer.from('invalid'),
      body: {},
      method: 'POST',
    })).resolves.toEqual({ body: 'fail' });
    expect(walletService.recharge).not.toHaveBeenCalled();
    expect(prisma.paymentCallbackEvent.create).not.toHaveBeenCalled();
  });
});
