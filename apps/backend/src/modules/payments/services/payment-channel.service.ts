import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentChannel,
  PaymentChannelType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PaymentChannelDto } from '@lumina/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentAdapterRegistry } from '../core/payment-adapter.registry';
import { PaymentChannelError, PaymentErrorCode } from '../core/payment.errors';
import { PaymentConfigCryptoService } from './payment-config-crypto.service';
import {
  CreatePaymentChannelDto,
  ListPaymentChannelsQueryDto,
  UpdatePaymentChannelDto,
} from '../dto/payment.dto';

@Injectable()
export class PaymentChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentAdapterRegistry,
    private readonly crypto: PaymentConfigCryptoService,
  ) {}

  listAdapters() {
    return this.registry.getAll().map((adapter) => adapter.getMetadata());
  }

  async listPublic(query: ListPaymentChannelsQueryDto): Promise<PaymentChannelDto[]> {
    const channels = await this.prisma.paymentChannel.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    return channels
      .map((channel) => this.serialize(channel))
      .filter((channel) => {
        const metadata = channel.metadata;
        return Boolean(
          metadata &&
            (!query.paymentMethod || metadata.methods.includes(query.paymentMethod)),
        );
      });
  }

  async listAdmin(): Promise<PaymentChannelDto[]> {
    const channels = await this.prisma.paymentChannel.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return channels.map((channel) => this.serialize(channel));
  }

  async create(dto: CreatePaymentChannelDto): Promise<PaymentChannelDto> {
    const type = dto.type as PaymentChannelType;
    const adapter = this.registry.get(type);
    await this.validate(adapter, dto.config);
    const configEncrypted = this.crypto.encrypt(dto.config);
    const channel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentChannel.create({
        data: {
          name: dto.name.trim(),
          type,
          isActive: dto.isActive ?? true,
          publicConfig: adapter.getPublicConfig(dto.config) as Prisma.InputJsonValue,
          configEncrypted,
        },
      });
      await tx.paymentChannelConfig.create({
        data: {
          channelId: created.id,
          version: created.configVersion,
          configEncrypted,
        },
      });
      return created;
    });
    return this.serialize(channel);
  }

  async update(id: string, dto: UpdatePaymentChannelDto): Promise<PaymentChannelDto> {
    const existing = await this.findById(id);
    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.config !== undefined) {
      const adapter = this.registry.get(existing.type);
      await this.validate(adapter, dto.config);
      data.publicConfig = adapter.getPublicConfig(dto.config) as Prisma.InputJsonValue;
      data.configEncrypted = this.crypto.encrypt(dto.config);
      data.configVersion = existing.configVersion + 1;
    }

    const channel = await this.prisma.$transaction(async (tx) => {
      if (dto.config === undefined) {
        return tx.paymentChannel.update({
          where: { id },
          data: data as never,
        });
      }

      const updated = await tx.paymentChannel.updateMany({
        where: { id, configVersion: existing.configVersion },
        data: data as never,
      });
      if (updated.count !== 1) {
        throw new BadRequestException('支付渠道配置已被并发更新，请刷新后重试');
      }
      const channel = await tx.paymentChannel.findUnique({ where: { id } });
      if (!channel) throw new NotFoundException('支付渠道不存在');
      const previousConfig = this.crypto.decrypt(existing.configEncrypted);
      const requestedAppId = typeof dto.config.appId === 'string' ? dto.config.appId.trim() : '';
      if (
        existing.type === PaymentChannelType.ALIPAY &&
        typeof dto.config.sellerId === 'string' &&
        dto.config.sellerId.trim() &&
        this.sameAppId(requestedAppId, previousConfig.appId)
      ) {
        // `sellerId` was not previously part of the config. When an operator
        // supplies it for the same Alipay app, apply that identity binding to
        // retained versions so existing in-flight orders remain verifiable.
        const versions = await tx.paymentChannelConfig.findMany({ where: { channelId: id } });
        for (const version of versions) {
          const historicalConfig = this.crypto.decrypt(version.configEncrypted);
          if (!this.sameAppId(requestedAppId, historicalConfig.appId) || historicalConfig.sellerId) continue;
          historicalConfig.sellerId = dto.config.sellerId.trim();
          await tx.paymentChannelConfig.update({
            where: { channelId_version: { channelId: id, version: version.version } },
            data: { configEncrypted: this.crypto.encrypt(historicalConfig) },
          });
        }
      }
      await tx.paymentChannelConfig.create({
        data: {
          channelId: id,
          version: channel.configVersion,
          configEncrypted: channel.configEncrypted,
        },
      });
      return channel;
    });
    return this.serialize(channel);
  }

  async setActive(id: string, isActive: boolean): Promise<PaymentChannelDto> {
    await this.findById(id);
    const channel = await this.prisma.paymentChannel.update({
      where: { id },
      data: { isActive },
    });
    return this.serialize(channel);
  }

  async test(id: string): Promise<{ ok: true; metadata: ReturnType<PaymentChannelService['listAdapters']>[number] }> {
    const channel = await this.findById(id);
    const adapter = this.registry.get(channel.type);
    await this.validate(adapter, this.decrypt(channel));
    return { ok: true, metadata: adapter.getMetadata() };
  }

  async getUsableChannel(
    id: string,
    paymentMethod: PaymentMethod,
    configVersion?: number,
  ): Promise<{
    channel: PaymentChannel;
    adapter: ReturnType<PaymentAdapterRegistry['get']>;
    config: Record<string, unknown>;
  }> {
    const channel = await this.findById(id);
    if (!channel.isActive) {
      throw new PaymentChannelError(PaymentErrorCode.CHANNEL_DISABLED, '支付渠道已停用');
    }
    const adapter = this.registry.get(channel.type);
    const metadata = adapter.getMetadata();
    if (!metadata.methods.includes(paymentMethod)) {
      throw new PaymentChannelError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_METHOD,
        '该渠道不支持当前支付方式',
      );
    }
    return { channel, adapter, config: configVersion === undefined
      ? this.decrypt(channel)
      : await this.decryptVersion(channel, configVersion) };
  }

  async getUsableChannelForMethod(
    paymentMethod: PaymentMethod,
  ): Promise<{
    channel: PaymentChannel;
    adapter: ReturnType<PaymentAdapterRegistry['get']>;
    config: Record<string, unknown>;
  }> {
    const channels = await this.prisma.paymentChannel.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });

    const preferredType = paymentMethod === PaymentMethod.ALIPAY
      ? PaymentChannelType.ALIPAY
      : PaymentChannelType.WECHAT;
    const matchingChannels = channels.filter((channel) => {
      const adapter = this.registry.get(channel.type);
      const metadata = adapter.getMetadata();
      return metadata.methods.includes(paymentMethod);
    });
    const selectedChannel = matchingChannels.find((channel) => channel.type === preferredType) ?? matchingChannels[0];
    if (selectedChannel) {
      const adapter = this.registry.get(selectedChannel.type);
      return { channel: selectedChannel, adapter, config: this.decrypt(selectedChannel) };
    }

    throw new PaymentChannelError(
      PaymentErrorCode.CHANNEL_NOT_FOUND,
      '当前支付方式暂无可用渠道，请联系管理员配置',
    );
  }

  async getById(id: string, configVersion?: number): Promise<{ channel: PaymentChannel; adapter: ReturnType<PaymentAdapterRegistry['get']>; config: Record<string, unknown> }> {
    const channel = await this.findById(id);
    return {
      channel,
      adapter: this.registry.get(channel.type),
      config: configVersion === undefined ? this.decrypt(channel) : await this.decryptVersion(channel, configVersion),
    };
  }

  async getNotificationCandidates(id: string): Promise<Array<{
    channel: PaymentChannel;
    adapter: ReturnType<PaymentAdapterRegistry['get']>;
    version: number;
    config: Record<string, unknown>;
  }>> {
    const channel = await this.findById(id);
    const versions = await this.prisma.paymentChannelConfig.findMany({
      where: { channelId: id },
      orderBy: { version: 'desc' },
    });
    const candidates = versions.length > 0
      ? versions
      : [{ version: channel.configVersion, configEncrypted: channel.configEncrypted }];
    const currentConfig = channel.type === PaymentChannelType.ALIPAY
      ? this.decrypt(channel)
      : undefined;
    return candidates.map((version) => ({
      channel,
      adapter: this.registry.get(channel.type),
      version: version.version,
      config: this.enrichAlipayIdentity(
        channel.type,
        this.decrypt(version.configEncrypted),
        currentConfig,
      ),
    }));
  }

  private async decryptVersion(channel: PaymentChannel, version: number): Promise<Record<string, unknown>> {
    const record = await this.prisma.paymentChannelConfig.findUnique({
      where: { channelId_version: { channelId: channel.id, version } },
    });
    if (!record) throw new NotFoundException('支付订单关联的渠道配置版本不存在');
    const config = this.decrypt(record.configEncrypted);
    if (channel.type !== PaymentChannelType.ALIPAY) return config;
    return this.enrichAlipayIdentity(channel.type, config, this.decrypt(channel));
  }

  private enrichAlipayIdentity(
    type: PaymentChannelType,
    config: Record<string, unknown>,
    currentConfig?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      type === PaymentChannelType.ALIPAY &&
      !config.sellerId &&
      currentConfig?.sellerId &&
      this.sameAppId(config.appId, currentConfig.appId)
    ) {
      return { ...config, sellerId: currentConfig.sellerId };
    }
    return config;
  }

  private sameAppId(first: unknown, second: unknown): boolean {
    return typeof first === 'string' && typeof second === 'string' &&
      Boolean(first.trim()) && first.trim() === second.trim();
  }

  private async findById(id: string): Promise<PaymentChannel> {
    const channel = await this.prisma.paymentChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('支付渠道不存在');
    return channel;
  }

  private decrypt(channel: PaymentChannel): Record<string, unknown> {
    try {
      return this.crypto.decrypt(channel.configEncrypted);
    } catch (error) {
      throw new BadRequestException(`支付渠道配置无法解密: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async validate(adapter: ReturnType<PaymentAdapterRegistry['get']>, config: Record<string, unknown>) {
    try {
      await adapter.validateConfig(config);
    } catch (error) {
      if (error instanceof PaymentChannelError) throw error;
      throw new BadRequestException(
        `支付渠道配置不合法: ${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  private serialize(channel: PaymentChannel): PaymentChannelDto {
    const adapter = this.registry.get(channel.type);
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      isActive: channel.isActive,
      publicConfig: (channel.publicConfig as Record<string, unknown> | null) ?? null,
      metadata: adapter.getMetadata(),
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    };
  }
}
