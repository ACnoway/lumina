import { HttpException, HttpStatus } from '@nestjs/common';

export enum PaymentErrorCode {
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_DISABLED = 'CHANNEL_DISABLED',
  UNSUPPORTED_PAYMENT_METHOD = 'UNSUPPORTED_PAYMENT_METHOD',
  UNSUPPORTED_PAYMENT_SCENE = 'UNSUPPORTED_PAYMENT_SCENE',
  INVALID_CHANNEL_CONFIG = 'INVALID_CHANNEL_CONFIG',
  CHANNEL_REQUEST_FAILED = 'CHANNEL_REQUEST_FAILED',
  CHANNEL_REQUEST_TIMEOUT = 'CHANNEL_REQUEST_TIMEOUT',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  PAYMENT_ORDER_NOT_FOUND = 'PAYMENT_ORDER_NOT_FOUND',
  PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH',
  PAYMENT_CURRENCY_MISMATCH = 'PAYMENT_CURRENCY_MISMATCH',
  PAYMENT_ALREADY_CLOSED = 'PAYMENT_ALREADY_CLOSED',
}

export class PaymentChannelError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    readonly uncertain = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PaymentChannelError';
  }
}

export class PaymentHttpException extends HttpException {
  constructor(code: PaymentErrorCode, message: string, status = HttpStatus.BAD_REQUEST) {
    super({ code, message }, status);
  }
}
