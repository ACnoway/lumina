import type {
  CurrencySettingsDto,
  GetPaymentOrdersResponse,
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

  listPendingOrders(): Promise<GetPaymentOrdersResponse> {
    const params = new URLSearchParams({
      page: '1',
      limit: '20',
    });
    return apiClient.get(`/payments/orders?${params.toString()}`);
  },

  getOrder(orderNo: string): Promise<PaymentOrderDto> {
    return apiClient.get(`/payments/orders/${encodeURIComponent(orderNo)}`);
  },

  resumeOrder(orderNo: string): Promise<PaymentOrderDto> {
    return apiClient.post(`/payments/orders/${encodeURIComponent(orderNo)}/pay`);
  },

  syncOrder(orderNo: string): Promise<PaymentOrderDto> {
    return apiClient.post(`/payments/orders/${encodeURIComponent(orderNo)}/sync`);
  },
};
