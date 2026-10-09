import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHmac, randomUUID } from 'crypto';
import { SmsChannelType } from '@prisma/client';
import { maskSecret } from '../../../auth/phone.util';
import { SmsChannelAdapter, SmsChannelMetadata, SmsPurpose } from '../../core/sms.types';
import { SmsChannelError, SmsErrorCode } from '../../core/sms.errors';

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  endpoint?: string;
  timeout?: number;
}

@Injectable()
export class AliyunSmsAdapter implements SmsChannelAdapter<AliyunSmsConfig> {
  readonly type = SmsChannelType.ALIYUN;

  getMetadata(): SmsChannelMetadata {
    return { type: this.type, name: '阿里云短信', capabilities: { send: true, testConnection: true } };
  }

  async validateConfig(config: AliyunSmsConfig): Promise<void> {
    if (!config?.accessKeyId?.trim() || !config.accessKeySecret?.trim() || !config.signName?.trim() || !config.templateCode?.trim()) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '阿里云短信 accessKeyId、accessKeySecret、signName、templateCode 不能为空');
    }
    if (config.endpoint && !this.isSecureEndpoint(config.endpoint)) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '阿里云短信 endpoint 必须为 HTTPS 地址');
    }
  }

  getPublicConfig(config: AliyunSmsConfig): Record<string, unknown> {
    return {
      accessKeyId: maskSecret(config.accessKeyId),
      signName: config.signName,
      templateCode: config.templateCode,
      endpoint: config.endpoint || 'https://dysmsapi.aliyuncs.com',
      secretConfigured: Boolean(config.accessKeySecret),
    };
  }

  async sendVerificationCode(phone: string, code: string, _purpose: SmsPurpose, config: AliyunSmsConfig): Promise<void> {
    await this.validateConfig(config);
    const params: Record<string, string> = {
      AccessKeyId: config.accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      SignName: config.signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      TemplateCode: config.templateCode,
      TemplateParam: JSON.stringify({ code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25',
    };
    params.Signature = this.signature(params, config.accessKeySecret);
    try {
      const response = await axios.get(config.endpoint || 'https://dysmsapi.aliyuncs.com', {
        params,
        timeout: config.timeout ?? 15000,
      });
      if (response.data?.Code && response.data.Code !== 'OK') {
        throw new Error(String(response.data.Message || response.data.Code));
      }
    } catch (error) {
      throw new SmsChannelError(SmsErrorCode.CHANNEL_REQUEST_FAILED, '阿里云短信发送失败', error);
    }
  }

  async testConnection(config: AliyunSmsConfig): Promise<void> {
    await this.validateConfig(config);
  }

  private signature(params: Record<string, string>, secret: string): string {
    const canonicalized = Object.keys(params).sort().map((key) => `${this.encode(key)}=${this.encode(params[key])}`).join('&');
    const stringToSign = `GET&%2F&${this.encode(canonicalized)}`;
    return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
  }

  private encode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  private isSecureEndpoint(value: string): boolean {
    try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.search && !url.hash; } catch { return false; }
  }
}
