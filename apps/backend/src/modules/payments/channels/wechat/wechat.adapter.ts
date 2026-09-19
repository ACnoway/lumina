import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createDecipheriv, createSign, createVerify, randomBytes } from 'crypto';
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

export interface WechatPayConfig {
  appId: string;
  mchId: string;
  merchantSerialNo: string;
  merchantPrivateKey: string;
  apiV3Key: string;
  wechatPayPublicKey?: string;
  wechatPayPublicKeyId?: string;
  baseUrl?: string;
  timeout?: number;
}

@Injectable()
export class WechatPaymentAdapter implements PaymentChannelAdapter<WechatPayConfig> {
  readonly type = PaymentChannelType.WECHAT;

  getMetadata(): PaymentChannelMetadata {
    return {
      type: this.type,
      name: '微信支付官方',
      methods: [PaymentMethod.WECHAT],
      scenes: [PaymentScene.QR, PaymentScene.H5, PaymentScene.JSAPI],
      capabilities: { query: true, close: true, refund: false },
    };
  }

  async validateConfig(config: WechatPayConfig): Promise<void> {
    if (!config?.appId?.trim() || !config.mchId?.trim() || !config.merchantSerialNo?.trim()) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信 appId、mchId 和商户证书序列号不能为空');
    }
    if (!config.merchantPrivateKey?.trim() || !config.apiV3Key?.trim()) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信商户私钥和 APIv3 Key 不能为空');
    }
    if (Buffer.byteLength(config.apiV3Key, 'utf8') !== 32) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信 APIv3 Key 必须是 32 字节');
    }
    try {
      createSign('RSA-SHA256').update('lumina-config').sign(config.merchantPrivateKey);
    } catch (error) {
      throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信商户私钥格式不合法', false, error);
    }
  }

  getPublicConfig(config: WechatPayConfig): Record<string, unknown> {
    return {
      appId: this.mask(config.appId),
      mchId: this.mask(config.mchId),
      merchantSerialNo: this.mask(config.merchantSerialNo),
      baseUrl: config.baseUrl || 'https://api.mch.weixin.qq.com',
      merchantPrivateKeyConfigured: Boolean(config.merchantPrivateKey),
      apiV3KeyConfigured: Boolean(config.apiV3Key),
      wechatPayPublicKeyConfigured: Boolean(config.wechatPayPublicKey),
    };
  }

  async createPayment(
    context: PaymentContext,
    request: PaymentCreateRequest,
    config: WechatPayConfig,
  ): Promise<PaymentCreateResult> {
    await this.validateConfig(config);
    const amount = { total: Number(request.amount.times(100).toFixed(0)), currency: 'CNY' };
    const common = {
      appid: config.appId,
      mchid: config.mchId,
      description: request.subject,
      out_trade_no: context.orderNo,
      notify_url: context.notifyUrl,
      amount,
    };
    if (request.scene === PaymentScene.JSAPI) {
      if (!context.payerOpenId) {
        throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信 JSAPI 支付缺少用户 openid');
      }
      const response = await this.request('POST', '/v3/pay/transactions/jsapi', {
        ...common,
        payer: { openid: context.payerOpenId },
      }, config);
      const prepayId = this.stringValue(response.prepay_id);
      if (!prepayId) throw new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, '微信 JSAPI 未返回 prepay_id');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString('hex');
      const packageValue = `prepay_id=${prepayId}`;
      const paySign = this.sign(`${config.appId}\n${timestamp}\n${nonce}\n${packageValue}\n`, config.merchantPrivateKey);
      return {
        action: {
          type: 'JSAPI',
          params: { appId: config.appId, timeStamp: timestamp, nonceStr: nonce, package: packageValue, signType: 'RSA', paySign },
        },
      };
    }
    if (request.scene === PaymentScene.H5) {
      if (!context.clientIp) throw new PaymentChannelError(PaymentErrorCode.INVALID_CHANNEL_CONFIG, '微信 H5 支付缺少客户端 IP');
      const response = await this.request('POST', '/v3/pay/transactions/h5', {
        ...common,
        scene_info: { payer_client_ip: context.clientIp, h5_info: { type: 'WAP' } },
      }, config);
      const url = this.stringValue(response.h5_url);
      if (!url) throw new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, '微信 H5 未返回跳转地址');
      return { action: { type: 'REDIRECT_URL', url } };
    }
    const response = await this.request('POST', '/v3/pay/transactions/native', common, config);
    const codeUrl = this.stringValue(response.code_url);
    if (!codeUrl) throw new PaymentChannelError(PaymentErrorCode.CHANNEL_REQUEST_FAILED, '微信 Native 未返回二维码地址');
    return { action: { type: 'QR_CODE', content: codeUrl } };
  }

  async parseNotification(
    request: PaymentNotificationRequest,
    config: WechatPayConfig,
  ): Promise<PaymentNotification> {
    await this.validateConfig(config);
    const timestamp = this.header(request.headers, 'wechatpay-timestamp');
    const nonce = this.header(request.headers, 'wechatpay-nonce');
    const signature = this.header(request.headers, 'wechatpay-signature');
    if (!timestamp || !nonce || !signature || !config.wechatPayPublicKey) {
      throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '微信回调签名材料不完整');
    }
    const valid = createVerify('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${request.rawBody.toString('utf8')}\n`, 'utf8')
      .verify(config.wechatPayPublicKey, signature, 'base64');
    if (!valid) throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '微信回调签名无效');
    const envelope = JSON.parse(request.rawBody.toString('utf8')) as { resource?: Record<string, string> };
    if (!envelope.resource) throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '微信回调 resource 缺失');
    const resource = this.decryptResource(envelope.resource, config.apiV3Key);
    const tradeState = String(resource.trade_state ?? '').toUpperCase();
    return {
      eventId: String(resource.transaction_id ?? resource.out_trade_no ?? `${tradeState}:${timestamp}`),
      orderNo: String(resource.out_trade_no ?? ''),
      providerTradeNo: this.optionalString(resource.transaction_id),
      status: tradeState === 'SUCCESS' ? 'SUCCESS' : tradeState === 'CLOSED' ? 'CLOSED' : tradeState === 'PAYERROR' ? 'FAILED' : 'PENDING',
      amount: resource.amount && typeof resource.amount === 'object'
        ? this.fenToYuan((resource.amount as { payer_total?: unknown }).payer_total)
        : undefined,
      currency: 'CNY',
      paidAt: tradeState === 'SUCCESS' ? new Date(String(resource.success_time ?? Date.now())) : undefined,
    };
  }

  buildNotificationResponse(success: boolean): PaymentNotifyResponse {
    return { body: success ? { code: 'SUCCESS', message: '成功' } : { code: 'FAIL', message: '处理失败' }, contentType: 'application/json' };
  }

  async queryPayment(request: PaymentQueryRequest, config: WechatPayConfig): Promise<PaymentQueryResult> {
    const response = await this.request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(request.orderNo)}?mchid=${encodeURIComponent(config.mchId)}`, undefined, config);
    const tradeState = String(response.trade_state ?? '').toUpperCase();
    const amount = response.amount && typeof response.amount === 'object' ? this.optionalString((response.amount as { payer_total?: unknown }).payer_total) : undefined;
    return {
      status: tradeState === 'SUCCESS' ? 'SUCCESS' : tradeState === 'CLOSED' ? 'CLOSED' : tradeState === 'PAYERROR' ? 'FAILED' : 'PENDING',
      providerTradeNo: this.optionalString(response.transaction_id),
      amount: amount ? (Number(amount) / 100).toFixed(2) : undefined,
      currency: 'CNY',
      paidAt: tradeState === 'SUCCESS' ? new Date(String(response.success_time ?? Date.now())) : undefined,
    };
  }

  private async request(method: 'GET' | 'POST', path: string, body: Record<string, unknown> | undefined, config: WechatPayConfig): Promise<Record<string, unknown>> {
    const bodyText = body ? JSON.stringify(body) : '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const signature = this.sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${bodyText}\n`, config.merchantPrivateKey);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.merchantSerialNo}",signature="${signature}"`;
    const options: AxiosRequestConfig = {
      method,
      baseURL: config.baseUrl || 'https://api.mch.weixin.qq.com',
      url: path,
      data: bodyText || undefined,
      timeout: config.timeout ?? 15000,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    try {
      const response: AxiosResponse<Record<string, unknown>> = await axios.request(options);
      this.verifyResponse(response, config);
      return response.data;
    } catch (error) {
      if (error instanceof PaymentChannelError) throw error;
      throw new PaymentChannelError(
        axios.isAxiosError(error) && error.code === 'ECONNABORTED' ? PaymentErrorCode.CHANNEL_REQUEST_TIMEOUT : PaymentErrorCode.CHANNEL_REQUEST_FAILED,
        '微信支付请求失败',
        axios.isAxiosError(error) && error.code === 'ECONNABORTED',
        error,
      );
    }
  }

  private verifyResponse(response: AxiosResponse<Record<string, unknown>>, config: WechatPayConfig): void {
    if (!config.wechatPayPublicKey) return;
    const timestamp = this.header(response.headers as Record<string, unknown>, 'wechatpay-timestamp');
    const nonce = this.header(response.headers as Record<string, unknown>, 'wechatpay-nonce');
    const signature = this.header(response.headers as Record<string, unknown>, 'wechatpay-signature');
    if (!timestamp || !nonce || !signature) return;
    const body = JSON.stringify(response.data);
    const valid = createVerify('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`, 'utf8').verify(config.wechatPayPublicKey, signature, 'base64');
    if (!valid) throw new PaymentChannelError(PaymentErrorCode.SIGNATURE_INVALID, '微信响应签名无效');
  }

  private decryptResource(resource: Record<string, string>, apiV3Key: string): Record<string, unknown> {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext) as Record<string, unknown>;
  }

  private sign(message: string, privateKey: string): string {
    return createSign('RSA-SHA256').update(message, 'utf8').sign(privateKey, 'base64');
  }

  private header(headers: Record<string, unknown> | Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.replace(/(^|-)([a-z])/g, (_, _a, letter) => letter.toUpperCase())];
    return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private optionalString(value: unknown): string | undefined {
    return value === undefined || value === null || value === '' ? undefined : String(value);
  }

  private fenToYuan(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return (Number(value) / 100).toFixed(2);
  }

  private mask(value: string): string {
    return value.length <= 4 ? '****' : `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
}
