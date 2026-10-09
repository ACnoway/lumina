import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SmsChannel, SmsChannelType } from '@prisma/client';
import { SmsChannelDto } from '@lumina/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAdapterRegistry } from '../core/sms-adapter.registry';
import { SmsChannelError, SmsErrorCode } from '../core/sms.errors';
import { SmsPurpose } from '../core/sms.types';
import { CreateSmsChannelDto, UpdateSmsChannelDto } from '../dto/sms.dto';
import { SmsConfigCryptoService } from './sms-config-crypto.service';

@Injectable()
export class SmsChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SmsAdapterRegistry,
    private readonly crypto: SmsConfigCryptoService,
  ) {}

  listAdapters() { return this.registry.getAll().map((adapter) => adapter.getMetadata()); }

  async listAdmin(): Promise<SmsChannelDto[]> {
    const channels = await this.prisma.smsChannel.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });
    return channels.map((channel) => this.serialize(channel));
  }

  async create(dto: CreateSmsChannelDto): Promise<SmsChannelDto> {
    const type = dto.type as SmsChannelType;
    const adapter = this.registry.get(type);
    await adapter.validateConfig(dto.config);
    const channel = await this.prisma.smsChannel.create({
      data: {
        name: dto.name.trim(), type, isActive: dto.isActive ?? true,
        publicConfig: adapter.getPublicConfig(dto.config) as Prisma.InputJsonValue,
        configEncrypted: this.crypto.encrypt(dto.config),
      },
    });
    return this.serialize(channel);
  }

  async update(id: string, dto: UpdateSmsChannelDto): Promise<SmsChannelDto> {
    const existing = await this.findById(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.config !== undefined) {
      const adapter = this.registry.get(existing.type);
      await adapter.validateConfig(dto.config);
      data.publicConfig = adapter.getPublicConfig(dto.config) as Prisma.InputJsonValue;
      data.configEncrypted = this.crypto.encrypt(dto.config);
      data.configVersion = existing.configVersion + 1;
    }
    const channel = await this.prisma.smsChannel.update({ where: { id }, data: data as never });
    return this.serialize(channel);
  }

  async setActive(id: string, isActive: boolean): Promise<SmsChannelDto> {
    await this.findById(id);
    const channel = await this.prisma.smsChannel.update({ where: { id }, data: { isActive } });
    return this.serialize(channel);
  }

  async test(id: string): Promise<{ ok: true; metadata: ReturnType<SmsChannelService['listAdapters']>[number] }> {
    const channel = await this.findById(id);
    const adapter = this.registry.get(channel.type);
    await adapter.testConnection(this.crypto.decrypt(channel.configEncrypted));
    return { ok: true, metadata: adapter.getMetadata() };
  }

  async sendVerificationCode(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    const channel = await this.prisma.smsChannel.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!channel) throw new SmsChannelError(SmsErrorCode.CHANNEL_DISABLED, '暂无启用的短信渠道，请联系管理员');
    const adapter = this.registry.get(channel.type);
    const config = this.crypto.decrypt(channel.configEncrypted);
    try {
      await adapter.sendVerificationCode(phone, code, purpose, config);
    } catch (error) {
      if (error instanceof SmsChannelError) throw error;
      throw new SmsChannelError(SmsErrorCode.CHANNEL_REQUEST_FAILED, '短信发送失败', error);
    }
  }

  private async findById(id: string): Promise<SmsChannel> {
    const channel = await this.prisma.smsChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('短信渠道不存在');
    return channel;
  }

  private serialize(channel: SmsChannel): SmsChannelDto {
    let metadata;
    try { metadata = this.registry.get(channel.type).getMetadata(); } catch { metadata = undefined; }
    return {
      id: channel.id, name: channel.name, type: channel.type, isActive: channel.isActive,
      publicConfig: (channel.publicConfig as Record<string, unknown> | null) ?? null,
      metadata, configVersion: channel.configVersion,
      createdAt: channel.createdAt.toISOString(), updatedAt: channel.updatedAt.toISOString(),
    };
  }
}
