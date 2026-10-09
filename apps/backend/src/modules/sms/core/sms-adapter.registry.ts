import { Inject, Injectable } from '@nestjs/common';
import { SmsChannelType } from '@prisma/client';
import { SmsChannelAdapter } from './sms.types';
import { SmsChannelError, SmsErrorCode } from './sms.errors';

export const SMS_ADAPTERS = 'SMS_ADAPTERS';

@Injectable()
export class SmsAdapterRegistry {
  private readonly adapters = new Map<SmsChannelType, SmsChannelAdapter>();

  constructor(@Inject(SMS_ADAPTERS) adapters: SmsChannelAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.type)) {
        throw new Error(`Duplicate SMS adapter: ${adapter.type}`);
      }
      this.adapters.set(adapter.type, adapter);
    }
  }

  get(type: SmsChannelType): SmsChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new SmsChannelError(SmsErrorCode.CHANNEL_NOT_FOUND, `不支持短信渠道类型: ${type}`);
    }
    return adapter;
  }

  getAll(): SmsChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
