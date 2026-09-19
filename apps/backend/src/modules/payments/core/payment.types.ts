import { PaymentChannelType, PaymentMethod, PaymentScene } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type PaymentAction =
  | { type: 'REDIRECT_URL'; url: string }
  | { type: 'HTML_FORM'; html: string }
  | { type: 'QR_CODE'; content: string }
  | { type: 'JSAPI'; params: Record<string, string> }
  | { type: 'NONE' };

export interface PaymentChannelMetadata {
  type: PaymentChannelType;
  name: string;
  methods: PaymentMethod[];
  scenes: PaymentScene[];
  capabilities: { query: boolean; close: boolean; refund: boolean };
}

export interface PaymentContext {
  orderNo: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
  payerOpenId?: string;
}

export interface PaymentCreateRequest {
  amount: Decimal;
  paymentMethod: PaymentMethod;
  scene: PaymentScene;
  subject: string;
}

export interface PaymentCreateResult {
  providerTradeNo?: string;
  action: PaymentAction;
  expireAt?: Date;
}

export interface PaymentNotificationRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: unknown;
  method?: string;
}

export type PaymentNotificationStatus = 'SUCCESS' | 'PENDING' | 'CLOSED' | 'FAILED';

export interface PaymentNotification {
  eventId: string;
  orderNo: string;
  providerTradeNo?: string;
  status: PaymentNotificationStatus;
  amount?: string;
  currency?: string;
  paidAt?: Date;
  /**
   * Whether the notification itself passed the channel signature check.
   * A provider-side authenticated query fallback is deliberately marked false
   * so callback audit records do not claim that an invalid signature was valid.
   */
  signatureValid?: boolean;
}

export interface PaymentNotifyResponse {
  body: string | Record<string, unknown>;
  contentType?: string;
}

export interface PaymentQueryRequest {
  orderNo: string;
  providerTradeNo?: string;
}

export interface PaymentQueryResult {
  status: PaymentNotificationStatus;
  providerTradeNo?: string;
  amount?: string;
  currency?: string;
  paidAt?: Date;
}

export interface PaymentChannelAdapter<TConfig = unknown> {
  readonly type: PaymentChannelType;
  getMetadata(): PaymentChannelMetadata;
  validateConfig(config: TConfig): Promise<void>;
  getPublicConfig(config: TConfig): Record<string, unknown>;
  createPayment(
    context: PaymentContext,
    request: PaymentCreateRequest,
    config: TConfig,
  ): Promise<PaymentCreateResult>;
  parseNotification(
    request: PaymentNotificationRequest,
    config: TConfig,
  ): Promise<PaymentNotification>;
  buildNotificationResponse(success: boolean): PaymentNotifyResponse;
  queryPayment?(request: PaymentQueryRequest, config: TConfig): Promise<PaymentQueryResult>;
}
