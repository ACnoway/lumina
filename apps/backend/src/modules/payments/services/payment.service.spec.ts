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
      findMany: jest.fn(),
      count: jest.fn(),
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
  const adapter = {
    createPayment: jest.fn(),
    queryPayment: jest.fn(),
    parseNotification: jest.fn(),
    buildNotificationResponse: jest.fn((success: boolean) => ({ body: success ? 'success' : 'fail' })),
  };
  const channel = makeOrder().channel;
  const channels = {
    getById: jest.fn().mockResolvedValue({ adapter, config: {} }),
    getUsableChannel: jest.fn().mockResolvedValue({ channel, adapter, config: {} }),
    getUsableChannelForMethod: jest.fn().mockResolvedValue({ channel, adapter, config: {} }),
  };
  const settingsService = {
    getCurrencySettings: jest.fn().mockResolvedValue({ photonPerCny: 10 }),
  };
  const config = {
    get: jest.fn((key: string) => key === 'PAYMENT_NOTIFY_BASE_URL' ? 'https://api.example.com' : undefined),
  };
  const service = new PaymentService(
    prisma as unknown as PrismaService,
    walletService as unknown as WalletService,
    settingsService as unknown as SettingsService,
    channels as never,
    config as unknown as ConfigService,
  );
  return { service, prisma, walletService, adapter, channels, settingsService, config };
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

  it('rejects recharge amounts below 0.1 yuan before selecting a channel', async () => {
    const { service, prisma } = createService();
    prisma.paymentOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.createPayment(
        { id: 'user-1' } as never,
        { amount: '0.09', paymentMethod: 'ALIPAY' },
        'payment-idempotency-2',
      ),
    ).rejects.toThrow('充值金额必须在 0.1 至 100000 元之间');
  });

  it('accepts a provider QR action without passing a generic scene to the adapter', async () => {
    const { service, prisma, walletService, adapter, channels } = createService();
    const order = { ...makeOrder(PaymentOrderStatus.CREATED), scene: 'WEB' as const };
    prisma.paymentOrder.findFirst.mockResolvedValue(null);
    prisma.paymentOrder.create.mockResolvedValue(order);
    prisma.paymentOrder.findUnique.mockResolvedValue(order);
    adapter.createPayment.mockResolvedValue({
      action: { type: 'QR_CODE', content: 'weixin://qr-code' },
      legacyScene: 'QR',
    });

    await expect(
      service.createPayment(
        { id: order.userId } as never,
        { amount: '10.00', paymentMethod: 'ALIPAY' },
        'payment-idempotency-redirect-only',
      ),
    ).resolves.toMatchObject({
      orderNo: order.orderNo,
      status: PaymentOrderStatus.PENDING,
      action: { type: 'QR_CODE', content: 'weixin://qr-code' },
    });

    expect(channels.getUsableChannelForMethod).toHaveBeenCalledWith('ALIPAY');
    expect(adapter.createPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ scene: expect.anything() }),
      {},
    );
    expect(walletService.recharge).not.toHaveBeenCalled();
  });

  it('rejects an unsafe provider redirect URL before exposing it to the browser', async () => {
    const { service, prisma, adapter } = createService();
    const order = { ...makeOrder(PaymentOrderStatus.CREATED), scene: 'WEB' as const };
    prisma.paymentOrder.findFirst.mockResolvedValue(null);
    prisma.paymentOrder.create.mockResolvedValue(order);
    adapter.createPayment.mockResolvedValue({
      action: { type: 'REDIRECT_URL', url: 'javascript:alert(document.domain)' },
    });

    await expect(
      service.createPayment(
        { id: order.userId } as never,
        { amount: '10.00', paymentMethod: 'ALIPAY' },
        'payment-idempotency-unsafe-redirect',
      ),
    ).rejects.toThrow('当前支付方式未返回可用的支付动作');

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentOrderStatus.FAILED }),
    }));
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

  it('expires stale orders before returning or syncing them', async () => {
    const { service, prisma, adapter, walletService } = createService();
    const order = {
      ...makeOrder(),
      expireAt: new Date(Date.now() - 1_000),
    };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.getOrder(order.userId, order.orderNo)).resolves.toMatchObject({
      status: PaymentOrderStatus.EXPIRED,
    });
    await expect(service.syncOrder(order.userId, order.orderNo)).resolves.toMatchObject({
      status: PaymentOrderStatus.EXPIRED,
    });

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
      }),
      data: { status: PaymentOrderStatus.EXPIRED },
    }));
    expect(adapter.queryPayment).not.toHaveBeenCalled();
    expect(walletService.recharge).not.toHaveBeenCalled();
  });

  it('returns only the current user\'s unexpired payable orders with pagination', async () => {
    const { service, prisma } = createService();
    const order = makeOrder();
    prisma.paymentOrder.findMany.mockResolvedValue([order]);
    prisma.paymentOrder.count.mockResolvedValue(1);

    await expect(
      service.listOrders(order.userId, { status: 'PENDING', page: 2, limit: 5, sortBy: 'expireAt', sortOrder: 'asc' }),
    ).resolves.toMatchObject({
      items: [{ orderNo: order.orderNo, status: PaymentOrderStatus.PENDING }],
      total: 1,
      page: 2,
      limit: 5,
      totalPages: 1,
    });

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: order.userId,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
      }),
      data: { status: PaymentOrderStatus.EXPIRED },
    }));
    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: order.userId,
        status: { in: [PaymentOrderStatus.PENDING] },
        paidAt: null,
      }),
      orderBy: { expireAt: 'asc' },
      skip: 5,
      take: 5,
    }));
  });

  it('does not credit the wallet for a late successful callback on an expired order', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = {
      ...makeOrder(),
      expireAt: new Date(Date.now() - 1_000),
    };
    adapter.parseNotification.mockResolvedValue({
      eventId: 'late-payment-event',
      orderNo: order.orderNo,
      providerTradeNo: 'T-late-paid',
      status: 'SUCCESS',
      amount: '10.00',
      currency: 'CNY',
    });
    prisma.paymentCallbackEvent.findUnique.mockResolvedValue(null);
    prisma.paymentOrder.findUnique.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.processNotification(order.channelId, {
      headers: {},
      rawBody: Buffer.from('late-payment'),
      body: {},
      method: 'POST',
    })).resolves.toEqual({ body: 'fail' });

    expect(walletService.recharge).not.toHaveBeenCalled();
    expect(prisma.paymentCallbackEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ errorMessage: expect.stringContaining('不能再次入账') }),
    }));
  });

  it('reuses a saved redirect action without creating a second payment order', async () => {
    const { service, prisma, adapter, channels } = createService();
    const order = {
      ...makeOrder(),
      metadata: {
        action: { type: 'REDIRECT_URL', url: 'https://pay.example.com/orders/1' },
        actionGeneratedAt: new Date().toISOString(),
      } as never,
    };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);

    await expect(service.resumePayment(order.userId, order.orderNo)).resolves.toMatchObject({
      orderNo: order.orderNo,
      action: { type: 'REDIRECT_URL', url: 'https://pay.example.com/orders/1' },
    });

    expect(adapter.createPayment).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
    expect(channels.getUsableChannel).toHaveBeenCalledWith(order.channelId, order.paymentMethod);
  });

  it('regenerates a missing action with the same original order snapshot', async () => {
    const { service, prisma, adapter } = createService();
    const order = { ...makeOrder(), scene: 'WEB' as const, metadata: null };
    const action = { type: 'HTML_FORM' as const, html: '<form></form>' };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.paymentOrder.findUnique.mockResolvedValue({
      ...order,
      metadata: { action },
    });
    adapter.createPayment.mockResolvedValue({ providerTradeNo: 'T-regenerated', action });

    await expect(service.resumePayment(order.userId, order.orderNo, '203.0.113.4')).resolves.toMatchObject({
      orderNo: order.orderNo,
      action,
    });

    expect(adapter.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: order.orderNo, clientIp: '203.0.113.4' }),
      expect.objectContaining({
        amount: order.amount,
        paymentMethod: order.paymentMethod,
        subject: order.subject,
      }),
      {},
    );
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: order.id }),
      data: expect.objectContaining({
        status: PaymentOrderStatus.PENDING,
        providerTradeNo: 'T-regenerated',
        metadata: expect.objectContaining({ action, actionGeneratedAt: expect.any(String) }),
      }),
    }));
  });

  it('refreshes a legacy saved action instead of returning an action with no generation timestamp', async () => {
    const { service, prisma, adapter, channels } = createService();
    const legacyAction = { type: 'REDIRECT_URL' as const, url: 'https://pay.example.com/legacy' };
    const action = { type: 'REDIRECT_URL' as const, url: 'https://pay.example.com/fresh' };
    const order = {
      ...makeOrder(),
      scene: 'WEB' as const,
      metadata: { action: legacyAction } as never,
    };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.paymentOrder.findUnique.mockResolvedValue({
      ...order,
      metadata: { action, actionGeneratedAt: new Date().toISOString() },
    });
    adapter.createPayment.mockResolvedValue({ providerTradeNo: 'T-refreshed', action });

    await expect(service.resumePayment(order.userId, order.orderNo)).resolves.toMatchObject({ action });

    expect(channels.getUsableChannel).toHaveBeenCalledWith(order.channelId, order.paymentMethod);
    expect(adapter.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: order.orderNo }),
      expect.objectContaining({ amount: order.amount }),
      {},
    );
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: PaymentOrderStatus.PENDING,
        providerTradeNo: 'T-refreshed',
        metadata: expect.objectContaining({ action, actionGeneratedAt: expect.any(String) }),
      }),
    }));
  });

  it('keeps the original order pending when regenerated payment action fails', async () => {
    const { service, prisma, adapter } = createService();
    const order = { ...makeOrder(), scene: 'WEB' as const, metadata: null };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    adapter.createPayment.mockRejectedValue(
      new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, 'channel unavailable'),
    );

    await expect(service.resumePayment(order.userId, order.orderNo)).rejects.toThrow('channel unavailable');

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paidAt: null }),
      data: expect.objectContaining({ status: PaymentOrderStatus.PENDING }),
    }));
  });

  it('does not expire or resume an active order already claimed by a confirmed payment', async () => {
    const { service, prisma, adapter, channels } = createService();
    const order = {
      ...makeOrder(),
      paidAt: new Date(),
      paidAmount: new Decimal('10.00'),
      expireAt: new Date(Date.now() - 1_000),
    };
    prisma.paymentOrder.findFirst.mockResolvedValue(order);

    await expect(service.resumePayment(order.userId, order.orderNo)).rejects.toThrow('正在入账');

    expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled();
    expect(channels.getUsableChannel).not.toHaveBeenCalled();
    expect(adapter.createPayment).not.toHaveBeenCalled();
  });

  it('re-drives idempotent wallet credit when another handler already claimed paidAt', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder();
    const paidAt = new Date();
    const claimedOrder = {
      ...order,
      providerTradeNo: 'T-claimed',
      paidAmount: new Decimal('10.00'),
      paidAt,
    };
    prisma.paymentOrder.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...claimedOrder, status: PaymentOrderStatus.SUCCEEDED });
    prisma.paymentOrder.findUnique.mockResolvedValue(claimedOrder);
    prisma.paymentOrder.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    adapter.queryPayment.mockResolvedValue({
      status: 'SUCCESS',
      providerTradeNo: 'T-duplicate',
      amount: '10.00',
      currency: 'CNY',
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
      expect.objectContaining({ providerTradeNo: 'T-claimed', paidAt: paidAt.toISOString() }),
    );
    expect(prisma.paymentOrder.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paidAt: { not: null } }),
      data: expect.objectContaining({ status: PaymentOrderStatus.SUCCEEDED }),
    }));
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
    prisma.paymentOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    walletService.recharge.mockResolvedValue({});

    await expect(service.syncOrder(order.userId, order.orderNo)).resolves.toMatchObject({
      status: PaymentOrderStatus.SUCCEEDED,
    });
    expect(walletService.recharge).toHaveBeenCalledWith(
      order.userId,
      100,
      `支付充值 ${order.orderNo}`,
      `payment:recharge:${order.orderNo}`,
      expect.objectContaining({
        orderNo: order.orderNo,
        providerTradeNo: 'T-paid',
        orderAmountCny: '10',
        paidAmountCny: '10',
        exchangeRate: '10',
        photonAmount: '100',
        paymentMethod: 'ALIPAY',
        channelName: '测试易支付',
        status: PaymentOrderStatus.SUCCEEDED,
        paidAt: expect.any(String),
      }),
    );
    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
      }),
    }));
    expect(prisma.paymentOrder.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paidAt: { not: null } }),
      data: expect.objectContaining({ status: PaymentOrderStatus.SUCCEEDED }),
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

  it('processes SUCCESS after an earlier PENDING callback with the same provider trade number', async () => {
    const { service, prisma, walletService, adapter } = createService();
    const order = makeOrder();
    adapter.parseNotification
      .mockResolvedValueOnce({
        eventId: 'T-state-transition',
        orderNo: order.orderNo,
        providerTradeNo: 'T-state-transition',
        status: 'PENDING',
        amount: '10.00',
        currency: 'CNY',
      })
      .mockResolvedValueOnce({
        eventId: 'T-state-transition',
        orderNo: order.orderNo,
        providerTradeNo: 'T-state-transition',
        status: 'SUCCESS',
        amount: '10.00',
        currency: 'CNY',
      });
    prisma.paymentCallbackEvent.findUnique.mockResolvedValue(null);
    prisma.paymentOrder.findUnique.mockResolvedValue(order);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    walletService.recharge.mockResolvedValue({});
    const request = {
      headers: {},
      rawBody: Buffer.from('state-transition'),
      body: {},
      method: 'POST' as const,
    };

    await expect(service.processNotification(order.channelId, request)).resolves.toEqual({ body: 'success' });
    await expect(service.processNotification(order.channelId, request)).resolves.toEqual({ body: 'success' });

    expect(prisma.paymentCallbackEvent.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ eventKey: 'T-state-transition:PENDING' }),
    }));
    expect(prisma.paymentCallbackEvent.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ eventKey: 'T-state-transition:SUCCESS' }),
    }));
    expect(walletService.recharge).toHaveBeenCalledTimes(1);
  });
});
