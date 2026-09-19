import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreatePaymentOrderDto, ListPaymentChannelsQueryDto } from '../dto/payment.dto';
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

  @Get('orders/:orderNo')
  @ApiOperation({ summary: '查询当前用户的支付订单' })
  getOrder(@CurrentUser() user: User, @Param('orderNo') orderNo: string) {
    return this.paymentService.getOrder(user.id, orderNo);
  }

  @Post('orders/:orderNo/sync')
  @ApiOperation({ summary: '主动同步支付订单状态' })
  syncOrder(@CurrentUser() user: User, @Param('orderNo') orderNo: string) {
    return this.paymentService.syncOrder(user.id, orderNo);
  }
}
