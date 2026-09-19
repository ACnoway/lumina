import { Inject, Injectable } from '@nestjs/common';
import { PaymentChannelType } from '@prisma/client';
import { PaymentChannelAdapter } from './payment.types';
import { PaymentChannelError, PaymentErrorCode } from './payment.errors';

export const PAYMENT_ADAPTERS = 'PAYMENT_ADAPTERS';

@Injectable()
export class PaymentAdapterRegistry {
  private readonly adapters = new Map<PaymentChannelType, PaymentChannelAdapter>();

  constructor(@Inject(PAYMENT_ADAPTERS) adapters: PaymentChannelAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.type)) {
        throw new Error(`Duplicate payment adapter: ${adapter.type}`);
      }
      this.adapters.set(adapter.type, adapter);
    }
  }

  get(type: PaymentChannelType): PaymentChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new PaymentChannelError(
        PaymentErrorCode.CHANNEL_NOT_FOUND,
        `不支持支付渠道类型: ${type}`,
      );
    }
    return adapter;
  }

  getAll(): PaymentChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
