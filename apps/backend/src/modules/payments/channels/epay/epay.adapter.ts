import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { PaymentChannelType, PaymentMethod, PaymentScene } from '@prisma/client';
import {
  PaymentChannelAdapter,
  PaymentChannelMetadata,
  PaymentContext,
  PaymentCreateRequest,
  PaymentCreateResult,
  PaymentNotification,
  PaymentNotificationRequest,
  PaymentNotifyResponse,
  PaymentQueryRequest,
  PaymentQueryResult,
} from '../../core/payment.types';
import { PaymentChannelError, PaymentErrorCode } from '../../core/payment.errors';

export interface EpayConfig {
  baseUrl: string;
  pid: string;
  key: string;
  protocolVersion?: 'V1';
  signType?: 'MD5';
  supportedTypes?: { alipay?: boolean; wxpay?: boolean };
  timeout?: number;
}

@Injectable()
export class EpayPaymentAdapter implements PaymentChannelAdapter<EpayConfig> {
  readonly type = PaymentChannelType.EPAY;

  getMetadata(): PaymentChannelMetadata {
    return {
      type: this.type,
      name: '易支付',
      methods: [PaymentMethod.ALIPAY, PaymentMethod.WECHAT],
      scenes: [PaymentScene.WEB, PaymentScene.QR],
      capabilities: { query: true, close: false, refund: false },
    };
  }

  async validateConfig(config: EpayConfig): Promise<void> {
    if (!config || typeof config.baseUrl !== 'string' || !/^https?:\/\//i.test(config.baseUrl)) {
      throw new PaymentChannelError(
        PaymentErrorCode.INVALID_CHANNEL_CONFIG,
        '易支付 baseUrl 不合法',
      );
    }
    if (!config.pid?.trim() || !config.key?.trim()) {
      throw new PaymentChannelError(
        PaymentErrorCode.INVALID_CHANNEL_CONFIG,
        '易支付 pid 和 key 不能为空',
      );
    }
  }

  getPublicConfig(config: EpayConfig): Record<string, unknown> {
    return {
      baseUrl: config.baseUrl,
      pid: this.mask(config.pid),
      protocolVersion: config.protocolVersion ?? 'V1',
      signType: config.signType ?? 'MD5',
      supportedTypes: config.supportedTypes ?? { alipay: true, wxpay: true },
      keyConfigured: Boolean(config.key),
    };
  }

  async createPayment(
    context: PaymentContext,
    request: PaymentCreateRequest,
    config: EpayConfig,
  ): Promise<PaymentCreateResult> {
    await this.validateConfig(config);
    const type = request.paymentMethod === PaymentMethod.ALIPAY ? 'alipay' : 'wxpay';
    const values: Record<string, string> = {
      pid: config.pid,
      type,
      out_trade_no: context.orderNo,
      notify_url: context.notifyUrl,
      return_url: context.returnUrl,
      name: request.subject,
      money: request.amount.toFixed(2),
      ...(context.clientIp ? { clientip: context.clientIp } : {}),
    };
    const signed = this.withSignature(values, config.key);
    try {
      const response = await axios.post(
        `${config.baseUrl.replace(/\/$/, '')}/mapi.php`,
        new URLSearchParams({ ...signed, sign_type: config.signType ?? 'MD5' }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: config.timeout ?? 15000,
        },
      );
      const data = this.parseResponse(response.data);
      const qr = this.firstString(data, ['qrcode', 'qr_code', 'code_url', 'payurl']);
      if (qr)
        return {
          action: { type: 'QR_CODE', content: qr },
          providerTradeNo: this.firstString(data, ['trade_no']),
        };
      const url = this.firstString(data, ['url', 'pay_url', 'redirect_url']);
      if (url)
        return {
          action: { type: 'REDIRECT_URL', url },
          providerTradeNo: this.firstString(data, ['trade_no']),
        };
      if (typeof response.data === 'string' && /<form[\s>]/i.test(response.data)) {
        return { action: { type: 'HTML_FORM', html: response.data } };
      }
      throw new Error('易支付返回中没有可用的支付动作');
    } catch (error) {
      if (error instanceof PaymentChannelError) throw error;
      throw new PaymentChannelError(
        axios.isAxiosError(error) && error.code === 'ECONNABORTED'
          ? PaymentErrorCode.CHANNEL_REQUEST_TIMEOUT
          : PaymentErrorCode.CHANNEL_REQUEST_FAILED,
        '易支付下单失败',
        axios.isAxiosError(error) && error.code === 'ECONNABORTED',
        error,
      );
    }
  }

  async parseNotification(
    request: PaymentNotificationRequest,
    config: EpayConfig,
  ): Promise<PaymentNotification> {
    await this.validateConfig(config);
    const payload = this.bodyAsRecord(request.body, request.rawBody);
    const signature = String(payload.sign ?? '');
    const values = { ...payload };
    delete values.sign;
    delete values.sign_type;
    const expected = this.signature(values, config.key);
    if (!signature || signature.toLowerCase() !== expected.toLowerCase()) {
      const fallback = await this.queryAfterInvalidGetSignature(request, payload, config);
      if (fallback) return { ...fallback, signatureValid: false };
      throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '易支付回调签名无效');
    }
    const status = String(payload.trade_status ?? '').toUpperCase();
    return {
      eventId: String(payload.trade_no ?? `${payload.out_trade_no}:${status}`),
      orderNo: String(payload.out_trade_no ?? ''),
      providerTradeNo: this.optionalString(payload.trade_no),
      status:
        status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED'
          ? 'SUCCESS'
          : status === 'TRADE_CLOSED'
            ? 'CLOSED'
            : 'PENDING',
      amount: this.optionalString(payload.money),
      currency: 'CNY',
      paidAt: status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED' ? new Date() : undefined,
      signatureValid: true,
    };
  }

  buildNotificationResponse(success: boolean): PaymentNotifyResponse {
    return { body: success ? 'success' : 'fail', contentType: 'text/plain; charset=utf-8' };
  }

  async queryPayment(
    request: PaymentQueryRequest,
    config: EpayConfig,
  ): Promise<PaymentQueryResult> {
    await this.validateConfig(config);
    const params = {
      act: 'order',
      pid: config.pid,
      key: config.key,
      out_trade_no: request.orderNo,
    };
    try {
      const response = await axios.get(`${config.baseUrl.replace(/\/$/, '')}/api.php`, {
        params,
        timeout: config.timeout ?? 10000,
      });
      const data = this.parseResponse(response.data);
      // Epay-compatible gateways commonly return code=1 to indicate that the
      // query request itself succeeded. It is not a payment state. Only an
      // explicit provider order status may confirm payment; unknown states
      // remain PENDING (fail closed).
      const rawStatus = data.trade_status ?? data.status;
      const status = String(rawStatus ?? '').toUpperCase();
      const isSuccess = status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED' || status === 'SUCCESS' || status === '1';
      return {
        status:
          isSuccess
            ? 'SUCCESS'
            : status === 'TRADE_CLOSED'
              ? 'CLOSED'
              : 'PENDING',
        providerTradeNo: this.firstString(data, ['trade_no']),
        amount: this.firstString(data, ['money', 'amount']),
        currency: 'CNY',
      };
    } catch (error) {
      throw new PaymentChannelError(
        PaymentErrorCode.CHANNEL_REQUEST_FAILED,
        '易支付订单查询失败',
        false,
        error,
      );
    }
  }

  private async queryAfterInvalidGetSignature(
    request: PaymentNotificationRequest,
    payload: Record<string, unknown>,
    config: EpayConfig,
  ): Promise<PaymentNotification | undefined> {
    if (
      request.method !== 'GET' ||
      typeof payload.out_trade_no !== 'string' ||
      !payload.out_trade_no
    )
      return undefined;
    try {
      const result = await this.queryPayment({ orderNo: payload.out_trade_no }, config);
      if (result.status !== 'SUCCESS' && result.status !== 'CLOSED') return undefined;
      return {
        eventId: result.providerTradeNo ?? `${payload.out_trade_no}:${result.status}`,
        orderNo: payload.out_trade_no,
        providerTradeNo: result.providerTradeNo,
        status: result.status,
        amount: result.amount,
        currency: result.currency ?? 'CNY',
        paidAt: result.status === 'SUCCESS' ? new Date() : undefined,
        signatureValid: false,
      };
    } catch {
      return undefined;
    }
  }

  private withSignature(values: Record<string, string>, key: string): Record<string, string> {
    return { ...values, sign: this.signature(values, key) };
  }

  private signature(values: Record<string, unknown>, key: string): string {
    const content = Object.keys(values)
      .filter(
        (name) =>
          name !== 'sign' &&
          name !== 'sign_type' &&
          values[name] !== undefined &&
          values[name] !== '',
      )
      .sort()
      .map((name) => `${name}=${String(values[name])}`)
      .join('&');
    return createHash('md5').update(`${content}${key}`, 'utf8').digest('hex');
  }

  private bodyAsRecord(body: unknown, raw: Buffer): Record<string, unknown> {
    if (body && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries());
  }

  private parseResponse(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          return parsed as Record<string, unknown>;
      } catch {
        return { url: value.trim() };
      }
    }
    return {};
  }

  private firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys)
      if (typeof value[key] === 'string' && value[key]) return value[key] as string;
    return undefined;
  }

  private optionalString(value: unknown): string | undefined {
    return value === undefined || value === null || value === '' ? undefined : String(value);
  }

  private mask(value: string): string {
    if (!value) return '';
    return value.length <= 4 ? '****' : `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
}
