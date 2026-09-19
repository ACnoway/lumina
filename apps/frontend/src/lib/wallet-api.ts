import type {
  GetBalanceResponse,
  GetTransactionsResponse,
  TransactionType,
} from '@lumina/shared';
import { apiClient } from './api-client';

export interface GetWalletTransactionsOptions {
  page?: number;
  limit?: number;
  type?: TransactionType;
}

export const walletApi = {
  getBalance(): Promise<GetBalanceResponse> {
    return apiClient.get('/wallet/balance');
  },

  getTransactions(
    options: GetWalletTransactionsOptions = {},
  ): Promise<GetTransactionsResponse> {
    const params = new URLSearchParams();
    params.set('page', String(options.page ?? 1));
    params.set('limit', String(options.limit ?? 10));
    if (options.type) params.set('type', options.type);
    return apiClient.get(`/wallet/transactions?${params.toString()}`);
  },
};
