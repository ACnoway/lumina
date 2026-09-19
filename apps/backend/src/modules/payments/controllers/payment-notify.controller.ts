import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('payments')
@Controller('payments/notify')
export class PaymentNotifyController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get(':channelId')
  @ApiOperation({ summary: '接收支付渠道 GET 异步通知' })
  async notifyGet(
    @Param('channelId') channelId: string,
    @Req() request: RawBodyRequest,
    @Res() response: Response,
  ) {
    const query = request.query as Record<string, unknown>;
    return this.handleNotification(
      channelId,
      request,
      response,
      query,
      Buffer.from(
        request.originalUrl?.split('?')[1] ??
          new URLSearchParams(query as Record<string, string>).toString(),
      ),
    );
  }

  @Post(':channelId')
  @ApiOperation({ summary: '接收支付渠道 POST 异步通知' })
  async notifyPost(
    @Param('channelId') channelId: string,
    @Req() request: RawBodyRequest,
    @Res() response: Response,
  ) {
    return this.handleNotification(channelId, request, response, request.body, request.rawBody);
  }

  private async handleNotification(
    channelId: string,
    request: RawBodyRequest,
    response: Response,
    body: unknown,
    rawBody?: Buffer,
  ) {
    const result = await this.paymentService.processNotification(channelId, {
      headers: request.headers,
      rawBody: rawBody ?? Buffer.from(JSON.stringify(body ?? {})),
      body,
    });
    response.type(result.contentType ?? 'application/json').send(result.body);
  }
}
