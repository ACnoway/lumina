import type {
  CurrencySettingsDto,
  PaymentMethod,
  PaymentOrderDto,
} from '@lumina/shared';
import { apiClient } from './api-client';

export const paymentsApi = {
  getRechargeSettings(): Promise<CurrencySettingsDto> {
    return apiClient.get('/payments/recharge-settings');
  },

  createOrder(
    data: {
      amount: string;
      paymentMethod: PaymentMethod;
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
