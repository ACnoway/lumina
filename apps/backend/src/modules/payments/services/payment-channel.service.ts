import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentChannel,
  PaymentChannelType,
  PaymentMethod,
  PaymentScene,
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
            (!query.paymentMethod || metadata.methods.includes(query.paymentMethod)) &&
            (!query.scene || metadata.scenes.includes(query.scene)),
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
    const channel = await this.prisma.paymentChannel.create({
      data: {
        name: dto.name.trim(),
        type,
        isActive: dto.isActive ?? true,
        publicConfig: adapter.getPublicConfig(dto.config) as Prisma.InputJsonValue,
        configEncrypted: this.crypto.encrypt(dto.config),
      },
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

    const channel = await this.prisma.paymentChannel.update({
      where: { id },
      data: data as never,
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
    scene: PaymentScene,
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
    if (!metadata.scenes.includes(scene)) {
      throw new PaymentChannelError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_SCENE,
        '该渠道不支持当前支付场景',
      );
    }
    return { channel, adapter, config: this.decrypt(channel) };
  }

  async getById(id: string): Promise<{ channel: PaymentChannel; adapter: ReturnType<PaymentAdapterRegistry['get']>; config: Record<string, unknown> }> {
    const channel = await this.findById(id);
    return { channel, adapter: this.registry.get(channel.type), config: this.decrypt(channel) };
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
