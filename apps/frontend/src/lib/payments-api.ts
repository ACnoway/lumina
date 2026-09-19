import type {
  PaymentChannelDto,
  PaymentMethod,
  PaymentOrderDto,
  PaymentScene,
} from '@lumina/shared';
import { apiClient } from './api-client';

export const paymentsApi = {
  getChannels(paymentMethod?: PaymentMethod, scene?: PaymentScene): Promise<PaymentChannelDto[]> {
    const params = new URLSearchParams();
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    if (scene) params.set('scene', scene);
    const query = params.toString();
    return apiClient.get(`/payments/channels${query ? `?${query}` : ''}`);
  },

  createOrder(
    data: {
      amount: string;
      paymentMethod: PaymentMethod;
      scene: PaymentScene;
      channelId: string;
    },
    idempotencyKey: string,
  ): Promise<PaymentOrderDto> {
    return apiClient.post('/payments/orders', data, { 'Idempotency-Key': idempotencyKey });
  },

  getOrder(orderNo: string): Promise<PaymentOrderDto> {
    return apiClient.get(`/payments/orders/${encodeURIComponent(orderNo)}`);
  },

  syncOrder(orderNo: string): Promise<PaymentOrderDto> {
    return apiClient.post(`/payments/orders/${encodeURIComponent(orderNo)}/sync`);
  },
};
