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
import { PaymentAction, PaymentOrderDto } from '@lumina/shared';
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
import { CreatePaymentOrderDto, ListPaymentChannelsQueryDto } from '../dto/payment.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

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
    if (existing) return this.serializeOrder(existing);

    let amount: Decimal;
    try {
      amount = new Decimal(dto.amount);
    } catch {
      throw new BadRequestException('充值金额格式不合法');
    }
    if (amount.lessThan('0.01') || amount.greaterThan('100000')) {
      throw new BadRequestException('充值金额必须在 0.01 至 100000 元之间');
    }

    const paymentMethod = dto.paymentMethod as PaymentMethod;
    const scene = dto.scene as PaymentScene;
    let usable: Awaited<ReturnType<PaymentChannelService['getUsableChannel']>>;
    try {
      usable = await this.channels.getUsableChannel(dto.channelId, paymentMethod, scene);
    } catch (error) {
      this.rethrowChannelError(error);
    }

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
    } catch (error) {
      const uncertain = error instanceof PaymentChannelError && error.uncertain;
      await this.prisma.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] },
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
      },
      data: {
        status: PaymentOrderStatus.PENDING,
        providerTradeNo: result!.providerTradeNo,
        expireAt: result!.expireAt ?? order.expireAt,
        metadata: { action: result!.action } as Prisma.InputJsonValue,
      },
    });
    const updated = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
      include: { channel: true },
    });
    if (!updated) throw new NotFoundException('支付订单不存在');
    this.logger.log(`payment.create.success orderNo=${orderNo} channelId=${order.channelId}`);
    return this.serializeOrder(updated);
  }

  async getOrder(userId: string, orderNo: string): Promise<PaymentOrderDto> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { orderNo, userId },
      include: { channel: true },
    });
    if (!order) throw new NotFoundException('支付订单不存在');
    return this.serializeOrder(order);
  }

  async syncOrder(userId: string, orderNo: string): Promise<PaymentOrderDto> {
    const order = await this.findUserOrder(userId, orderNo);
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

  private async applyPaymentResult(order: PaymentOrder, result: PaymentNotification | PaymentQueryResult): Promise<void> {
    if (result.status === 'SUCCESS') {
      if (order.status === PaymentOrderStatus.SUCCEEDED) return;
      if (order.status !== PaymentOrderStatus.CREATED && order.status !== PaymentOrderStatus.PENDING) {
        throw new PaymentChannelError(PaymentErrorCode.PAYMENT_ALREADY_CLOSED, '支付订单已关闭，不能再次入账');
      }
      this.assertConfirmedPayment(order, result);
      await this.processPaymentSuccess(order, result);
      return;
    }
    if (result.status === 'CLOSED' || result.status === 'FAILED') {
      if (order.status !== PaymentOrderStatus.SUCCEEDED) {
        await this.prisma.paymentOrder.updateMany({
          where: { id: order.id, status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] } },
          data: { status: result.status === 'CLOSED' ? PaymentOrderStatus.CLOSED : PaymentOrderStatus.FAILED },
        });
      }
    }
  }

  private async processPaymentSuccess(order: PaymentOrder, result: PaymentNotification | PaymentQueryResult): Promise<void> {
    await this.walletService.recharge(
      order.userId,
      Number(order.photonAmount.toString()),
      `支付充值 ${order.orderNo}`,
      `payment:recharge:${order.orderNo}`,
    );
    await this.prisma.paymentOrder.updateMany({
      where: { id: order.id, status: { in: [PaymentOrderStatus.CREATED, PaymentOrderStatus.PENDING] } },
      data: {
        status: PaymentOrderStatus.SUCCEEDED,
        providerTradeNo: result.providerTradeNo ?? order.providerTradeNo,
        paidAmount: result.amount ? new Decimal(result.amount) : order.amount,
        paidAt: result.paidAt ?? new Date(),
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

  private serializeOrder(order: PaymentOrder & { channel: PaymentChannel }): PaymentOrderDto {
    const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata as { action?: PaymentAction }
      : {};
    return {
      orderNo: order.orderNo,
      amount: order.amount.toString(),
      currency: order.currency,
      photonAmount: order.photonAmount.toString(),
      status: order.status,
      paymentMethod: order.paymentMethod,
      scene: order.scene,
      channel: { id: order.channel.id, name: order.channel.name, type: order.channel.type },
      action: metadata.action,
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
