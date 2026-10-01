import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentOrder,
  PaymentOrderStatus,
  PaymentScene,
  Prisma,
  User,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  GetPaymentOrdersResponse,
  PaymentAction,
  PaymentOrderDto,
} from '@lumina/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { SettingsService } from '../../settings/settings.service';
import { PaymentChannelService } from './payment-channel.service';
import { PaymentChannelError, PaymentErrorCode } from '../core/payment.errors';
import {
  PaymentCreateResult,
  PaymentNotification,
  PaymentNotificationRequest,
  PaymentNotifyResponse,
  PaymentQueryResult,
} from '../core/payment.types';
import {
  CreatePaymentOrderDto,
  ListPaymentChannelsQueryDto,
  ListPaymentOrdersQueryDto,
} from '../dto/payment.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  /** Redirect URLs and generated forms are provider artifacts with short lives. */
  private readonly ACTION_MAX_AGE_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly settingsService: SettingsService,
    private readonly channels: PaymentChannelService,
    private readonly config: ConfigService,
  ) {}

  listChannels(query: ListPaymentChannelsQueryDto) {
    return this.channels.listPublic(query);
  }

  getRechargeSettings() {
    return this.settingsService.getCurrencySettings();
  }

  async createPayment(
    user: User,
    dto: CreatePaymentOrderDto,
    idempotencyKey: string,
    clientIp?: string,
  ): Promise<PaymentOrderDto> {
    if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
      throw new BadRequestException('Idempotency-Key 必须存在且不超过 128 个字符');
    }
    const existing = await this.prisma.paymentOrder.findFirst({
      where: { userId: user.id, idempotencyKey },
      include: { channel: true },
    });
    if (existing) return this.serializeOrder(await this.expireOrderIfNeeded(existing));

    let amount: Decimal;
    try {
      amount = new Decimal(dto.amount);
    } catch {
      throw new BadRequestException('充值金额格式不合法');
    }
    if (amount.lessThan('0.1') || amount.greaterThan('100000')) {
      throw new BadRequestException('充值金额必须在 0.1 至 100000 元之间');
    }

    const paymentMethod = dto.paymentMethod as PaymentMethod;
    let selection: {
      scene: PaymentScene;
      usable: Awaited<ReturnType<PaymentChannelService['getUsableChannelForMethod']>>;
    };
    try {
      selection = await this.getUsableRedirectChannel(paymentMethod);
    } catch (error) {
      this.rethrowChannelError(error);
    }
    const { scene, usable } = selection!;

    const rate = new Decimal((await this.settingsService.getCurrencySettings()).photonPerCny.toString());
    const photonAmount = amount.times(rate).toDecimalPlaces(6);
    const orderNo = this.orderNo();
    const order = await this.prisma.paymentOrder.create({
      data: {
        orderNo,
        userId: user.id,
        channelId: usable!.channel.id,
        channelType: usable!.channel.type,
        paymentMethod,
        scene,
        amount,
        currency: 'CNY',
        photonAmount,
        photonPerCny: rate,
        subject: dto.subject?.trim() || 'Lumina 光子充值',
        status: PaymentOrderStatus.CREATED,
        expireAt: new Date(Date.now() + 30 * 60 * 1000),
        clientIp,
        idempotencyKey,
      },
      include: { channel: true },
    });

    const notifyUrl = `${this.publicBaseUrl()}/payments/notify/${encodeURIComponent(usable!.channel.id)}`;
    const returnUrl = this.config.get<string>('PAYMENT_RETURN_URL') || `${this.publicBaseUrl()}/profile`;
    let result: PaymentCreateResult;
    try {
      result = await usable!.adapter.createPayment(
        { orderNo, notifyUrl, returnUrl, clientIp, payerOpenId: dto.payerOpenId },
        { amount, paymentMethod, scene, subject: order.subject },
        usable!.config,
      );
      this.assertRedirectAction(result.action);
    } catch (error) {
      const uncertain = error instanceof PaymentChannelError && error.uncertain;
      await this.prisma.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
          paidAt: null,
        },
        data: {
          status: uncertain ? PaymentOrderStatus.PENDING : PaymentOrderStatus.FAILED,
          failureCode: error instanceof PaymentChannelError ? error.code : PaymentErrorCode.CHANNEL_REQUEST_FAILED,
          failureMessage: error instanceof Error ? error.message : '支付渠道请求失败',
        },
      });
      this.rethrowChannelError(error);
    }

    await this.prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
      },
      data: {
        status: PaymentOrderStatus.PENDING,
        providerTradeNo: result!.providerTradeNo,
        expireAt: result!.expireAt ?? order.expireAt,
        metadata: this.actionMetadata(result!.action),
      },
    });
    const updated = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
      include: { channel: true },
    });
    if (!updated) throw new NotFoundException('支付订单不存在');
    this.logger.log(`payment.create.success orderNo=${orderNo} channelId=${order.channelId}`);
    return this.serializeOrder(await this.expireOrderIfNeeded(updated));
  }

  async listOrders(
    userId: string,
    query: ListPaymentOrdersQueryDto,
  ): Promise<GetPaymentOrdersResponse> {
    const now = new Date();
    await this.expireStaleUserOrders(userId, now);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const statuses = query.status
      ? [query.status as PaymentOrderStatus]
      : [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING];
    const direction = query.sortOrder ?? 'desc';
    const orderBy = query.sortBy === 'expireAt'
      ? { expireAt: direction }
      : { createdAt: direction };
    const where = {
      userId,
      status: { in: statuses },
      // `paidAt` is the confirmed-payment claim. It is not user-payable while
      // wallet credit is being completed, so do not surface it as pending.
      paidAt: null,
      OR: [
        { expireAt: null },
        { expireAt: { gt: now } },
      ],
    };
    const [orders, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where,
        include: { channel: true },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentOrder.count({ where }),
    ]);

    return {
      items: orders.map((order) => this.serializeOrder(order)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrder(userId: string, orderNo: string): Promise<PaymentOrderDto> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { orderNo, userId },
      include: { channel: true },
    });
    if (!order) throw new NotFoundException('支付订单不存在');
    return this.serializeOrder(await this.expireOrderIfNeeded(order));
  }

  /**
   * Reuse the original Lumina order when the user returns to an unfinished
   * payment. A recent saved redirect action is returned as-is; a missing,
   * legacy, or stale action is regenerated with the same merchant order number
   * and all original monetary snapshots.
   */
  async resumePayment(
    userId: string,
    orderNo: string,
    clientIp?: string,
  ): Promise<PaymentOrderDto> {
    let order = await this.findUserOrder(userId, orderNo);
    order = await this.expireOrderIfNeeded(order);
    try {
      this.assertResumableOrder(order);
    } catch (error) {
      this.rethrowChannelError(error);
    }

    // An order remains bound to the channel originally selected at creation.
    // Never fall back to another channel when resuming it.
    let usable: Awaited<ReturnType<PaymentChannelService['getUsableChannel']>>;
    try {
      usable = await this.channels.getUsableChannel(
        order.channelId,
        order.paymentMethod,
        order.scene,
      );
    } catch (error) {
      this.rethrowChannelError(error);
    }

    const savedAction = this.getOrderAction(order);
    if (this.isFreshRedirectAction(order, savedAction)) return this.serializeOrder(order);

    let result: PaymentCreateResult;
    try {
      result = await usable!.adapter.createPayment(
        {
          orderNo: order.orderNo,
          notifyUrl: `${this.publicBaseUrl()}/payments/notify/${encodeURIComponent(order.channelId)}`,
          returnUrl: this.config.get<string>('PAYMENT_RETURN_URL') || `${this.publicBaseUrl()}/profile`,
          clientIp: clientIp ?? order.clientIp ?? undefined,
        },
        {
          amount: order.amount,
          paymentMethod: order.paymentMethod,
          scene: order.scene,
          subject: order.subject,
        },
        usable!.config,
      );
      this.assertRedirectAction(result.action);
    } catch (error) {
      await this.recordPaymentActionFailure(order, error);
      this.rethrowChannelError(error);
    }

    const updatedAction = await this.prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
        OR: [
          { expireAt: null },
          { expireAt: { gt: new Date() } },
        ],
      },
      data: {
        status: PaymentOrderStatus.PENDING,
        providerTradeNo: result!.providerTradeNo ?? order.providerTradeNo,
        expireAt: result!.expireAt ?? order.expireAt,
        metadata: this.actionMetadata(result!.action),
      },
    });

    const updated = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
      include: { channel: true },
    });
    if (!updated) throw new NotFoundException('支付订单不存在');
    const current = await this.expireOrderIfNeeded(updated);
    if (updatedAction.count === 0) {
      try {
        this.assertResumableOrder(current);
      } catch (error) {
        this.rethrowChannelError(error);
      }
      throw new BadRequestException('支付订单状态已变化，请刷新后重试');
    }
    return this.serializeOrder(current);
  }

  async syncOrder(userId: string, orderNo: string): Promise<PaymentOrderDto> {
    let order = await this.findUserOrder(userId, orderNo);
    order = await this.expireOrderIfNeeded(order);
    if (order.status === PaymentOrderStatus.EXPIRED) return this.serializeOrder(order);
    // A prior verified callback may have claimed payment immediately before a
    // process crash or a transient wallet failure. Finish that idempotently
    // rather than querying the provider or reopening the payment flow.
    if (this.isClaimedPayableOrder(order)) {
      await this.creditClaimedPayment(order);
      return this.getOrder(userId, orderNo);
    }
    const { adapter, config } = await this.channels.getById(order.channelId);
    if (!adapter.queryPayment) throw new BadRequestException('当前渠道不支持主动查询');
    let result: PaymentQueryResult;
    try {
      result = await adapter.queryPayment({ orderNo: order.orderNo, providerTradeNo: order.providerTradeNo ?? undefined }, config);
    } catch (error) {
      this.rethrowChannelError(error);
    }
    await this.applyPaymentResult(order, result!);
    return this.getOrder(userId, orderNo);
  }

  async processNotification(channelId: string, request: PaymentNotificationRequest): Promise<PaymentNotifyResponse> {
    const { adapter, config } = await this.channels.getById(channelId);
    let notification: PaymentNotification;
    try {
      notification = await adapter.parseNotification(request, config);
    } catch (error) {
      this.logger.warn(`payment.notify.signature_invalid channelId=${channelId}`);
      return adapter.buildNotificationResponse(false);
    }
    const payloadHash = createHash('sha256').update(request.rawBody).digest('hex');
    const existingEvent = await this.prisma.paymentCallbackEvent.findUnique({
      where: { channelId_eventKey: { channelId, eventKey: notification.eventId } },
    });
    if (existingEvent?.processed) return adapter.buildNotificationResponse(true);
    if (!existingEvent) {
      await this.prisma.paymentCallbackEvent.create({
        data: {
          channelId,
          orderNo: notification.orderNo,
          eventKey: notification.eventId,
          signatureValid: notification.signatureValid !== false,
          payloadHash,
        },
      });
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo: notification.orderNo },
      include: { channel: true },
    });
    if (!order || order.channelId !== channelId) {
      await this.markEventFailed(channelId, notification.eventId, '本地订单不存在或渠道不匹配');
      return adapter.buildNotificationResponse(false);
    }
    try {
      await this.applyPaymentResult(order, notification);
      await this.prisma.paymentCallbackEvent.update({
        where: { channelId_eventKey: { channelId, eventKey: notification.eventId } },
        data: { processed: true, processedAt: new Date(), errorMessage: null },
      });
      this.logger.log(`payment.notify.success orderNo=${order.orderNo} channelId=${channelId}`);
      return adapter.buildNotificationResponse(true);
    } catch (error) {
      await this.markEventFailed(channelId, notification.eventId, error instanceof Error ? error.message : '支付回调处理失败');
      return adapter.buildNotificationResponse(false);
    }
  }

  private async applyPaymentResult(
    order: PaymentOrder & { channel: PaymentChannel },
    result: PaymentNotification | PaymentQueryResult,
  ): Promise<void> {
    order = await this.expireOrderIfNeeded(order);
    if (result.status === 'SUCCESS') {
      if (order.status === PaymentOrderStatus.SUCCEEDED) return;
      this.assertPayableOrder(order, '支付订单已关闭或过期，不能再次入账');
      this.assertConfirmedPayment(order, result);
      await this.processPaymentSuccess(order, result);
      return;
    }
    if (result.status === 'CLOSED' || result.status === 'FAILED') {
      if (order.status !== PaymentOrderStatus.SUCCEEDED) {
        await this.prisma.paymentOrder.updateMany({
          where: {
            id: order.id,
            status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
            paidAt: null,
          },
          data: { status: result.status === 'CLOSED' ? PaymentOrderStatus.CLOSED : PaymentOrderStatus.FAILED },
        });
      }
    }
  }

  private async processPaymentSuccess(
    order: PaymentOrder & { channel: PaymentChannel },
    result: PaymentNotification | PaymentQueryResult,
  ): Promise<void> {
    const paidAmount = new Decimal(result.amount!);
    const paidAt = result.paidAt ?? new Date();

    // This update is the payment-success claim. It makes expiry and wallet
    // credit mutually exclusive without adding a schema column: expiry only
    // touches unpaid (`paidAt: null`) rows, while a successful claim can only
    // be made before `expireAt`.
    const claim = await this.prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
        OR: [
          { expireAt: null },
          { expireAt: { gt: new Date() } },
        ],
      },
      data: {
        providerTradeNo: result.providerTradeNo ?? order.providerTradeNo,
        paidAmount,
        paidAt,
        failureCode: null,
        failureMessage: null,
      },
    });

    if (claim.count > 0) {
      await this.creditClaimedPayment({
        ...order,
        providerTradeNo: result.providerTradeNo ?? order.providerTradeNo,
        paidAmount,
        paidAt,
      });
      return;
    }

    // A duplicate callback/query may race after another handler has already
    // claimed the order. Reload it and re-drive the wallet operation using the
    // stable idempotency key. If the claim was not won, an expired unpaid order
    // is explicitly expired and cannot be revived by this late success.
    const current = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
      include: { channel: true },
    });
    if (!current) throw new NotFoundException('支付订单不存在');
    const currentOrder = await this.expireOrderIfNeeded(current);
    if (currentOrder.status === PaymentOrderStatus.SUCCEEDED) return;
    if (this.isClaimedPayableOrder(currentOrder)) {
      await this.creditClaimedPayment(currentOrder);
      return;
    }
    this.assertPayableOrder(currentOrder, '支付订单已关闭或过期，不能再次入账');
    throw new PaymentChannelError(
      PaymentErrorCode.PAYMENT_ALREADY_CLOSED,
      '支付订单状态已变化，不能再次入账',
    );
  }

  /**
   * Complete an already claimed payment. The wallet transaction uses the
   * payment order number as its idempotency key, so retrying after a crash is
   * safe and turns a claimed active order into SUCCEEDED exactly once.
   */
  private async creditClaimedPayment(
    order: PaymentOrder & { channel: PaymentChannel },
  ): Promise<void> {
    this.assertPayableOrder(order, '支付订单已关闭或过期，不能再次入账');
    if (!order.paidAt) {
      throw new PaymentChannelError(
        PaymentErrorCode.PAYMENT_ALREADY_CLOSED,
        '支付订单尚未确认支付，不能入账',
      );
    }
    const paidAmount = order.paidAmount ?? order.amount;
    await this.walletService.recharge(
      order.userId,
      Number(order.photonAmount.toString()),
      `支付充值 ${order.orderNo}`,
      `payment:recharge:${order.orderNo}`,
      {
        orderNo: order.orderNo,
        providerTradeNo: order.providerTradeNo,
        orderAmountCny: order.amount.toString(),
        paidAmountCny: paidAmount.toString(),
        exchangeRate: order.photonPerCny.toString(),
        photonAmount: order.photonAmount.toString(),
        paymentMethod: order.paymentMethod,
        channelName: order.channel.name,
        status: PaymentOrderStatus.SUCCEEDED,
        paidAt: order.paidAt.toISOString(),
      },
    );
    await this.prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: { not: null },
      },
      data: {
        status: PaymentOrderStatus.SUCCEEDED,
        providerTradeNo: order.providerTradeNo,
        paidAmount,
        paidAt: order.paidAt,
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  private assertConfirmedPayment(order: PaymentOrder, result: PaymentNotification | PaymentQueryResult): void {
    if (typeof result.amount !== 'string' || !result.amount.trim()) {
      throw new PaymentChannelError(PaymentErrorCode.PAYMENT_AMOUNT_MISMATCH, '支付成功结果缺少支付金额');
    }

    let paidAmount: Decimal;
    try {
      paidAmount = new Decimal(result.amount);
    } catch {
      throw new PaymentChannelError(PaymentErrorCode.PAYMENT_AMOUNT_MISMATCH, '支付金额格式不合法');
    }
    if (!paidAmount.eq(order.amount)) {
      throw new PaymentChannelError(PaymentErrorCode.PAYMENT_AMOUNT_MISMATCH, '支付金额与本地订单不一致');
    }

    if (typeof result.currency !== 'string' || result.currency.toUpperCase() !== order.currency.toUpperCase()) {
      throw new PaymentChannelError(PaymentErrorCode.PAYMENT_CURRENCY_MISMATCH, '支付币种与本地订单不一致');
    }
  }

  private async findUserOrder(userId: string, orderNo: string) {
    const order = await this.prisma.paymentOrder.findFirst({ where: { userId, orderNo }, include: { channel: true } });
    if (!order) throw new NotFoundException('支付订单不存在');
    return order;
  }

  private async markEventFailed(channelId: string, eventKey: string, errorMessage: string) {
    await this.prisma.paymentCallbackEvent.updateMany({
      where: { channelId, eventKey },
      data: { errorMessage },
    });
  }

  private async getUsableRedirectChannel(paymentMethod: PaymentMethod): Promise<{
    scene: PaymentScene;
    usable: Awaited<ReturnType<PaymentChannelService['getUsableChannelForMethod']>>;
  }> {
    const scenes = paymentMethod === PaymentMethod.ALIPAY
      ? [PaymentScene.WEB, PaymentScene.H5]
      : [PaymentScene.H5, PaymentScene.WEB];

    for (const scene of scenes) {
      try {
        const usable = await this.channels.getUsableChannelForMethod(paymentMethod, scene);
        return { scene, usable };
      } catch (error) {
        if (
          error instanceof PaymentChannelError &&
          (error.code === PaymentErrorCode.CHANNEL_NOT_FOUND ||
            error.code === PaymentErrorCode.UNSUPPORTED_PAYMENT_SCENE)
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new PaymentChannelError(
      PaymentErrorCode.CHANNEL_NOT_FOUND,
      '当前支付方式暂无可用的跳转支付渠道',
    );
  }

  private getOrderAction(order: PaymentOrder): PaymentAction | undefined {
    return this.sanitizePaymentAction(this.getOrderMetadata(order).action);
  }

  private getOrderMetadata(order: PaymentOrder): Record<string, unknown> {
    return order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata as Record<string, unknown>
      : {};
  }

  /** Persist only the public action and its generation time, never raw channel output. */
  private actionMetadata(action: PaymentAction): Prisma.InputJsonValue {
    const safeAction = this.sanitizePaymentAction(action);
    if (!safeAction) {
      throw new PaymentChannelError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_SCENE,
        '当前支付方式未返回可用的跳转支付动作',
      );
    }
    return {
      action: safeAction,
      actionGeneratedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue;
  }

  private sanitizePaymentAction(value: unknown): PaymentAction | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const action = value as Record<string, unknown>;
    switch (action.type) {
      case 'REDIRECT_URL':
        return typeof action.url === 'string' && action.url.trim()
          ? { type: 'REDIRECT_URL', url: action.url }
          : undefined;
      case 'HTML_FORM':
        return typeof action.html === 'string' && action.html.trim()
          ? { type: 'HTML_FORM', html: action.html }
          : undefined;
      case 'QR_CODE':
        return typeof action.content === 'string' && action.content.trim()
          ? { type: 'QR_CODE', content: action.content }
          : undefined;
      case 'JSAPI': {
        if (!action.params || typeof action.params !== 'object' || Array.isArray(action.params)) return undefined;
        const params = Object.entries(action.params as Record<string, unknown>);
        if (params.some(([, value]) => typeof value !== 'string')) return undefined;
        return { type: 'JSAPI', params: Object.fromEntries(params) as Record<string, string> };
      }
      case 'NONE':
        return { type: 'NONE' };
      default:
        return undefined;
    }
  }

  private isFreshRedirectAction(order: PaymentOrder, action: PaymentAction | undefined): boolean {
    if (!this.isRedirectAction(action)) return false;
    const generatedAt = this.getOrderMetadata(order).actionGeneratedAt;
    if (typeof generatedAt !== 'string') return false;
    const generatedAtMs = new Date(generatedAt).getTime();
    const age = Date.now() - generatedAtMs;
    // A malformed or future timestamp is treated as stale conservatively.
    return Number.isFinite(generatedAtMs) && age >= 0 && age < this.ACTION_MAX_AGE_MS;
  }

  private isRedirectAction(action: PaymentAction | undefined): boolean {
    return Boolean(
      (action?.type === 'REDIRECT_URL' && typeof action.url === 'string' && action.url.trim()) ||
      (action?.type === 'HTML_FORM' && typeof action.html === 'string' && action.html.trim()),
    );
  }

  private assertRedirectAction(action: PaymentAction | undefined): void {
    if (this.isRedirectAction(action)) return;
    throw new PaymentChannelError(
      PaymentErrorCode.UNSUPPORTED_PAYMENT_SCENE,
      '当前支付方式未返回可用的跳转支付动作',
    );
  }

  private isPayableOrder(order: PaymentOrder): boolean {
    return order.status === PaymentOrderStatus.CREATED || order.status === PaymentOrderStatus.PENDING;
  }

  private assertPayableOrder(order: PaymentOrder, message = '支付订单当前状态不可继续支付'): void {
    if (this.isPayableOrder(order)) return;
    throw new PaymentChannelError(PaymentErrorCode.PAYMENT_ALREADY_CLOSED, message);
  }

  private isClaimedPayableOrder(order: PaymentOrder): boolean {
    return this.isPayableOrder(order) && order.paidAt !== null;
  }

  private assertResumableOrder(order: PaymentOrder): void {
    this.assertPayableOrder(order);
    if (order.paidAt !== null) {
      throw new PaymentChannelError(
        PaymentErrorCode.PAYMENT_ALREADY_CLOSED,
        '支付订单已确认支付，正在入账，不能继续支付',
      );
    }
  }

  private async expireStaleUserOrders(userId: string, now = new Date()): Promise<void> {
    await this.prisma.paymentOrder.updateMany({
      where: {
        userId,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
        expireAt: { lte: now },
      },
      data: { status: PaymentOrderStatus.EXPIRED },
    });
  }

  private async expireOrderIfNeeded(
    order: PaymentOrder & { channel: PaymentChannel },
  ): Promise<PaymentOrder & { channel: PaymentChannel }> {
    if (
      !this.isPayableOrder(order) ||
      order.paidAt !== null ||
      !order.expireAt ||
      order.expireAt.getTime() > Date.now()
    ) {
      return order;
    }

    const now = new Date();
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
        expireAt: { lte: now },
      },
      data: { status: PaymentOrderStatus.EXPIRED },
    });
    if (result.count > 0) {
      return { ...order, status: PaymentOrderStatus.EXPIRED };
    }

    // A concurrent successful callback can win the paidAt claim. Reload so a
    // stale unpaid view cannot subsequently expire or resume that order.
    const current = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
      include: { channel: true },
    });
    if (!current) throw new NotFoundException('支付订单不存在');
    return current;
  }

  private async recordPaymentActionFailure(
    order: PaymentOrder & { channel: PaymentChannel },
    error: unknown,
  ): Promise<void> {
    const current = await this.expireOrderIfNeeded(order);
    if (!this.isPayableOrder(current) || current.paidAt !== null) return;

    await this.prisma.paymentOrder.updateMany({
      where: {
        id: current.id,
        status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
        paidAt: null,
      },
      data: {
        // A resume failure must leave the original order payable. The user can
        // retry with the same order number after a transient channel problem.
        status: PaymentOrderStatus.PENDING,
        failureCode: error instanceof PaymentChannelError ? error.code : PaymentErrorCode.CHANNEL_REQUEST_FAILED,
        failureMessage: error instanceof Error ? error.message : '支付渠道请求失败',
      },
    });
  }

  private serializeOrder(order: PaymentOrder & { channel: PaymentChannel }): PaymentOrderDto {
    return {
      orderNo: order.orderNo,
      amount: order.amount.toString(),
      currency: order.currency,
      photonAmount: order.photonAmount.toString(),
      status: order.status,
      paymentMethod: order.paymentMethod,
      scene: order.scene,
      channel: { id: order.channel.id, name: order.channel.name, type: order.channel.type },
      action: order.paidAt === null ? this.getOrderAction(order) : undefined,
      expireAt: order.expireAt?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private publicBaseUrl(): string {
    const value = this.config.get<string>('PAYMENT_NOTIFY_BASE_URL')?.trim();
    if (!value) throw new BadRequestException('支付回调地址未配置');
    return value.replace(/\/$/, '');
  }

  private orderNo(): string {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `LM${stamp}${Math.floor(Math.random() * 1_000_000_000_000).toString().padStart(12, '0')}`;
  }

  private rethrowChannelError(error: unknown): never {
    if (error instanceof PaymentChannelError) {
      throw new BadRequestException({ code: error.code, message: error.message });
    }
    throw error;
  }
}
