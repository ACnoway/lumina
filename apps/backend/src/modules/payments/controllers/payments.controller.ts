import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreatePaymentOrderDto,
  ListPaymentChannelsQueryDto,
  ListPaymentOrdersQueryDto,
} from '../dto/payment.dto';
import { PaymentService } from '../services/payment.service';

@ApiTags('payments')
@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('channels')
  @ApiOperation({ summary: '获取可供用户选择的支付渠道' })
  getChannels(@Query() query: ListPaymentChannelsQueryDto) {
    return this.paymentService.listChannels(query);
  }

  @Get('recharge-settings')
  @ApiOperation({ summary: '获取充值汇率设置' })
  getRechargeSettings() {
    return this.paymentService.getRechargeSettings();
  }

  @Post('orders')
  @ApiOperation({ summary: '创建支付订单' })
  createOrder(
    @CurrentUser() user: User,
    @Body() dto: CreatePaymentOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: Request,
  ) {
    return this.paymentService.createPayment(user, dto, idempotencyKey, request.ip);
  }

  @Get('orders')
  @ApiOperation({ summary: '分页查询当前用户待支付订单' })
  listOrders(@CurrentUser() user: User, @Query() query: ListPaymentOrdersQueryDto) {
    return this.paymentService.listOrders(user.id, query);
  }

  @Get('orders/:orderNo')
  @ApiOperation({ summary: '查询当前用户的支付订单' })
  getOrder(@CurrentUser() user: User, @Param('orderNo') orderNo: string) {
    return this.paymentService.getOrder(user.id, orderNo);
  }

  @Post('orders/:orderNo/pay')
  @ApiOperation({ summary: '恢复当前用户原有支付订单的支付动作' })
  resumeOrder(
    @CurrentUser() user: User,
    @Param('orderNo') orderNo: string,
    @Req() request: Request,
  ) {
    return this.paymentService.resumePayment(user.id, orderNo, request.ip);
  }

  @Post('orders/:orderNo/sync')
  @ApiOperation({ summary: '主动同步支付订单状态' })
  syncOrder(@CurrentUser() user: User, @Param('orderNo') orderNo: string) {
    return this.paymentService.syncOrder(user.id, orderNo);
  }
}
