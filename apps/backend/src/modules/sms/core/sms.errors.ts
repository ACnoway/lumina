export enum SmsErrorCode {
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_DISABLED = 'CHANNEL_DISABLED',
  INVALID_CHANNEL_CONFIG = 'INVALID_CHANNEL_CONFIG',
  TEMPLATE_MISMATCH = 'TEMPLATE_MISMATCH',
  CHANNEL_REQUEST_FAILED = 'CHANNEL_REQUEST_FAILED',
}

export class SmsChannelError extends Error {
  constructor(
    readonly code: SmsErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SmsChannelError';
  }
}
