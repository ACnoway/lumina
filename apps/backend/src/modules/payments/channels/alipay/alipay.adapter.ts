import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createSign, createVerify } from 'crypto';
import { PaymentChannelType, PaymentMethod, PaymentScene } from '@prisma/client';
import {
  PaymentChannelAdapter,
  PaymentChannelMetadata,
  PaymentCloseRequest,
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

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  /** The official Alipay product used by this channel instance. */
  product?: 'PAGE' | 'WAP' | 'PRECREATE';
  gateway?: string;
  sandbox?: boolean;
  timeout?: number;
}

@Injectable()
export class AlipayPaymentAdapter implements PaymentChannelAdapter<AlipayConfig> {
  readonly type = PaymentChannelType.ALIPAY;

  getMetadata(): PaymentChannelMetadata {
    return {
      type: this.type,
      name: '支付宝官方',
      methods: [PaymentMethod.ALIPAY],
      scenes: [PaymentScene.WEB, PaymentScene.H5, PaymentScene.QR],
      capabilities: { query: true, close: true, refund: false },
    };
  }

  async validateConfig(config: AlipayConfig): Promise<void> {
    if (!config?.appId?.trim() || !config.privateKey?.trim() || !config.alipayPublicKey?.trim()) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '支付宝 appId、私钥和支付宝公钥不能为空');
    }
    if (config.product && !['PAGE', 'WAP', 'PRECREATE'].includes(config.product)) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '支付宝 product 必须为 PAGE、WAP 或 PRECREATE');
    }
    if (config.gateway && !this.isSecureEndpoint(config.gateway)) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '支付宝 gateway 必须为有效的 HTTPS 地址');
    }
    try {
      createSign('RSA-SHA256').update('lumina-config').sign(config.privateKey);
      createVerify('RSA-SHA256').update('lumina-config').verify(config.alipayPublicKey, Buffer.from('invalid'));
    } catch (error) {
      if (error instanceof Error && /sign|key/i.test(error.message)) {
        throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '支付宝密钥格式不合法', false, error);
      }
    }
  }

  getPublicConfig(config: AlipayConfig): Record<string, unknown> {
    return {
      appId: this.mask(config.appId),
      gateway: config.gateway || (config.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do'),
      product: config.product ?? 'PAGE',
      sandbox: Boolean(config.sandbox),
      privateKeyConfigured: Boolean(config.privateKey),
      alipayPublicKeyConfigured: Boolean(config.alipayPublicKey),
    };
  }

  async createPayment(
    context: PaymentContext,
    request: PaymentCreateRequest,
    config: AlipayConfig,
  ): Promise<PaymentCreateResult> {
    await this.validateConfig(config);
    const product = config.product ?? 'PAGE';
    if (product === 'PRECREATE') {
      const data = await this.callGateway('alipay.trade.precreate', {
        out_trade_no: context.orderNo,
        total_amount: request.amount.toFixed(2),
        subject: request.subject,
        notify_url: context.notifyUrl,
      }, config);
      const qr = this.readResponse(data, 'qr_code');
      if (!qr) throw new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, '支付宝未返回二维码');
      return { action: { type: 'QR_CODE', content: qr }, legacyScene: PaymentScene.QR };
    }

    const method = product === 'WAP' ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay';
    const fields = this.signedFields({
      app_id: config.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.timestamp(),
      version: '1.0',
      notify_url: context.notifyUrl,
      return_url: context.returnUrl,
      biz_content: JSON.stringify({
        out_trade_no: context.orderNo,
        product_code: product === 'WAP' ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY',
        total_amount: request.amount.toFixed(2),
        subject: request.subject,
      }),
    }, config.privateKey);
    const html = `<form id="alipay-submit" name="alipay-submit" action="${this.escape(this.gateway(config))}" method="post">${Object.entries(fields)
      .map(([key, value]) => `<input type="hidden" name="${this.escape(key)}" value="${this.escape(value)}">`)
      .join('')}</form><script>document.getElementById('alipay-submit').submit();</script>`;
    return {
      action: { type: 'HTML_FORM', html },
      legacyScene: product === 'WAP' ? PaymentScene.H5 : PaymentScene.WEB,
    };
  }

  async parseNotification(
    request: PaymentNotificationRequest,
    config: AlipayConfig,
  ): Promise<PaymentNotification> {
    await this.validateConfig(config);
    const payload = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : Object.fromEntries(new URLSearchParams(request.rawBody.toString('utf8')).entries());
    const signature = String(payload.sign ?? '');
    const content = this.signatureContent(payload);
    const valid = Boolean(signature) && createVerify('RSA-SHA256').update(content, 'utf8').verify(config.alipayPublicKey, signature, 'base64');
    if (!valid) throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '支付宝回调签名无效');
    const tradeStatus = String(payload.trade_status ?? '').toUpperCase();
    return {
      eventId: String(payload.trade_no ?? `${payload.out_trade_no}:${tradeStatus}`),
      orderNo: String(payload.out_trade_no ?? ''),
      providerTradeNo: this.optionalString(payload.trade_no),
      status: tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? 'SUCCESS' : tradeStatus === 'TRADE_CLOSED' ? 'CLOSED' : 'PENDING',
      amount: this.optionalString(payload.total_amount),
      currency: 'CNY',
      paidAt: tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? new Date() : undefined,
    };
  }

  buildNotificationResponse(success: boolean): PaymentNotifyResponse {
    return { body: success ? 'success' : 'fail', contentType: 'text/plain; charset=utf-8' };
  }

  async queryPayment(request: PaymentQueryRequest, config: AlipayConfig): Promise<PaymentQueryResult> {
    await this.validateConfig(config);
    const data = await this.callGateway('alipay.trade.query', { out_trade_no: request.orderNo }, config);
    const trade = this.readResponseObject(data);
    const status = String(trade.trade_status ?? '').toUpperCase();
    return {
      status: status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED' ? 'SUCCESS' : status === 'TRADE_CLOSED' ? 'CLOSED' : 'PENDING',
      providerTradeNo: this.optionalString(trade.trade_no),
      amount: this.optionalString(trade.total_amount),
      currency: 'CNY',
      paidAt: status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED' ? new Date() : undefined,
    };
  }

  async closePayment(request: PaymentCloseRequest, config: AlipayConfig): Promise<void> {
    await this.validateConfig(config);
    await this.callGateway('alipay.trade.close', {
      out_trade_no: request.orderNo,
      ...(request.providerTradeNo ? { trade_no: request.providerTradeNo } : {}),
    }, config);
  }

  private async callGateway(method: string, bizContent: Record<string, string>, config: AlipayConfig): Promise<Record<string, unknown>> {
    const fields = this.signedFields({
      app_id: config.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.timestamp(),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    }, config.privateKey);
    try {
      const response = await axios.post(this.gateway(config), new URLSearchParams(fields).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: config.timeout ?? 15000,
      });
      const value = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, '支付宝响应格式不合法');
      }
      const root = value as Record<string, unknown>;
      const responseObject = this.readResponseObject(root);
      const responseSignature = this.optionalString(root.sign);
      if (!responseSignature || !this.verifyResponse(responseObject, responseSignature, config.alipayPublicKey)) {
        throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '支付宝响应签名无效');
      }
      const code = this.optionalString(responseObject.code);
      if (code && code !== '10000') {
        throw new PaymentChannelError(
          PaymentErrorCode.CHANNEL_REQUEST_FAILED,
          this.optionalString(responseObject.sub_msg) ?? this.optionalString(responseObject.msg) ?? '支付宝请求被渠道拒绝',
        );
      }
      return responseObject;
    } catch (error) {
      if (error instanceof PaymentChannelError) throw error;
      throw new PaymentChannelError(
        axios.isAxiosError(error) && error.code === 'ECONNABORTED' ? PaymentErrorCode.CHANNEL_REQUEST_TIMEOUT : PaymentErrorCode.CHANNEL_REQUEST_FAILED,
        '支付宝请求失败',
        axios.isAxiosError(error) && error.code === 'ECONNABORTED',
        error,
      );
    }
  }

  private signedFields(fields: Record<string, string>, privateKey: string): Record<string, string> {
    const content = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('&');
    const sign = createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
    return { ...fields, sign };
  }

  private signatureContent(payload: Record<string, unknown>): string {
    return Object.keys(payload)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && payload[key] !== undefined && payload[key] !== '')
      .sort()
      .map((key) => `${key}=${String(payload[key])}`)
      .join('&');
  }

  private verifyResponse(response: Record<string, unknown>, signature: string, publicKey: string): boolean {
    return createVerify('RSA-SHA256')
      .update(JSON.stringify(response), 'utf8')
      .verify(publicKey, signature, 'base64');
  }

  private readResponse(value: Record<string, unknown>, key: string): string | undefined {
    return this.optionalString(this.readResponseObject(value)[key]);
  }

  private readResponseObject(value: Record<string, unknown>): Record<string, unknown> {
    const key = Object.keys(value).find((entry) => entry.endsWith('_response'));
    return key && value[key] && typeof value[key] === 'object' ? value[key] as Record<string, unknown> : value;
  }

  private gateway(config: AlipayConfig): string {
    return config.gateway || (config.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do');
  }

  private isSecureEndpoint(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }

  private timestamp(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  private optionalString(value: unknown): string | undefined {
    return value === undefined || value === null || value === '' ? undefined : String(value);
  }

  private escape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private mask(value: string): string {
    return value.length <= 4 ? '****' : `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
}
