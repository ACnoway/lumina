import { Controller, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('payments')
@Controller('payments/notify')
export class PaymentNotifyController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post(':channelId')
  @ApiOperation({ summary: '接收支付渠道异步通知' })
  async notify(@Param('channelId') channelId: string, @Req() request: RawBodyRequest, @Res() response: Response) {
    const result = await this.paymentService.processNotification(channelId, {
      headers: request.headers,
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {})),
      body: request.body,
    });
    response.type(result.contentType ?? 'application/json').send(result.body);
  }
}
