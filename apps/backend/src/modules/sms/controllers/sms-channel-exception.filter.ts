import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { SmsChannelError, SmsErrorCode } from '../core/sms.errors';

@Catch(SmsChannelError)
export class SmsChannelExceptionFilter implements ExceptionFilter<SmsChannelError> {
  catch(error: SmsChannelError, host: ArgumentsHost): void {
    const status = error.code === SmsErrorCode.CHANNEL_REQUEST_FAILED
      ? HttpStatus.BAD_GATEWAY
      : HttpStatus.BAD_REQUEST;
    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      code: error.code,
      message: error.message,
    });
  }
}
