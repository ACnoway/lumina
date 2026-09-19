import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User, UserRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuditService } from '../../audit/audit.service';
import {
  CreatePaymentChannelDto,
  UpdatePaymentChannelDto,
} from '../dto/payment.dto';
import { PaymentChannelService } from '../services/payment-channel.service';

@ApiTags('admin')
@Controller('admin/payment-channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class AdminPaymentChannelsController {
  constructor(
    private readonly channels: PaymentChannelService,
    private readonly audit: AuditService,
  ) {}

  @Get('adapters')
  @ApiOperation({ summary: '获取支付 Adapter 类型和能力' })
  listAdapters() {
    return this.channels.listAdapters();
  }

  @Get()
  @ApiOperation({ summary: '获取支付渠道实例' })
  listChannels() {
    return this.channels.listAdmin();
  }

  @Post()
  @ApiOperation({ summary: '创建支付渠道实例' })
  async create(@CurrentUser() actor: User, @Body() dto: CreatePaymentChannelDto, @Req() request: Request) {
    const channel = await this.channels.create(dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'payment_channel.created',
      resource: 'payment_channel',
      details: { targetId: channel.id, after: { name: channel.name, type: channel.type, isActive: channel.isActive } },
      ipAddress: request.ip,
      userAgent: request.get('user-agent') || undefined,
    });
    return channel;
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新支付渠道实例' })
  async update(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: UpdatePaymentChannelDto, @Req() request: Request) {
    const channel = await this.channels.update(id, dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'payment_channel.updated',
      resource: 'payment_channel',
      details: { targetId: channel.id, updatedFields: Object.keys(dto), after: { name: channel.name, type: channel.type, isActive: channel.isActive } },
      ipAddress: request.ip,
      userAgent: request.get('user-agent') || undefined,
    });
    return channel;
  }

  @Post(':id/enable')
  enable(@CurrentUser() actor: User, @Param('id') id: string, @Req() request: Request) {
    return this.toggle(actor, id, true, request);
  }

  @Post(':id/disable')
  disable(@CurrentUser() actor: User, @Param('id') id: string, @Req() request: Request) {
    return this.toggle(actor, id, false, request);
  }

  @Post(':id/test')
  @ApiOperation({ summary: '验证支付渠道配置' })
  async test(@CurrentUser() actor: User, @Param('id') id: string, @Req() request: Request) {
    const result = await this.channels.test(id);
    await this.audit.record({
      actorId: actor.id,
      action: 'payment_channel.tested',
      resource: 'payment_channel',
      details: { targetId: id, result: 'ok' },
      ipAddress: request.ip,
      userAgent: request.get('user-agent') || undefined,
    });
    return result;
  }

  private async toggle(actor: User, id: string, isActive: boolean, request: Request) {
    const channel = await this.channels.setActive(id, isActive);
    await this.audit.record({
      actorId: actor.id,
      action: isActive ? 'payment_channel.enabled' : 'payment_channel.disabled',
      resource: 'payment_channel',
      details: { targetId: id, isActive },
      ipAddress: request.ip,
      userAgent: request.get('user-agent') || undefined,
    });
    return channel;
  }
}
