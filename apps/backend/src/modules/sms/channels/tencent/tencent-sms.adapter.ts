import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHmac, randomInt } from 'crypto';
import { SmsChannelType } from '@prisma/client';
import { maskSecret } from '../../../auth/phone.util';
import { SmsChannelAdapter, SmsChannelMetadata, SmsPurpose } from '../../core/sms.types';
import { SmsChannelError, SmsErrorCode } from '../../core/sms.errors';

export interface TencentSmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
  region?: string;
  endpoint?: string;
  timeout?: number;
}

@Injectable()
export class TencentSmsAdapter implements SmsChannelAdapter<TencentSmsConfig> {
  readonly type = SmsChannelType.TENCENT;

  getMetadata(): SmsChannelMetadata {
    return { type: this.type, name: '腾讯云短信', capabilities: { send: true, testConnection: true } };
  }

  async validateConfig(config: TencentSmsConfig): Promise<void> {
    if (!config?.secretId?.trim() || !config.secretKey?.trim() || !config.sdkAppId?.trim() || !config.signName?.trim() || !config.templateId?.trim()) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '腾讯云短信 secretId、secretKey、sdkAppId、signName、templateId 不能为空');
    }
    if (config.endpoint && !this.isSecureEndpoint(config.endpoint)) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '腾讯云短信 endpoint 必须为 HTTPS 地址');
    }
  }

  getPublicConfig(config: TencentSmsConfig): Record<string, unknown> {
    return {
      secretId: maskSecret(config.secretId),
      sdkAppId: config.sdkAppId,
      signName: config.signName,
      templateId: config.templateId,
      region: config.region || 'ap-guangzhou',
      endpoint: config.endpoint || 'https://sms.tencentcloudapi.com',
      secretConfigured: Boolean(config.secretKey),
    };
  }

  async sendVerificationCode(phone: string, code: string, _purpose: SmsPurpose, config: TencentSmsConfig): Promise<void> {
    await this.validateConfig(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      Action: 'SendSms',
      Version: '2021-01-11',
      Region: config.region || 'ap-guangzhou',
      Timestamp: timestamp,
      Nonce: randomInt(1, 2 ** 31),
      SecretId: config.secretId,
      SmsSdkAppId: config.sdkAppId,
      SignName: config.signName,
      TemplateId: config.templateId,
      TemplateParamSet: [code],
      PhoneNumberSet: [phone],
    };
    const query = Object.keys(payload).sort().map((key) => `${key}=${encodeURIComponent(String(payload[key as keyof typeof payload]))}`).join('&');
    const signature = createHmac('sha1', config.secretKey).update(`POSTsms.tencentcloudapi.com/?${query}`).digest('base64');
    try {
      const response = await axios.post(config.endpoint || 'https://sms.tencentcloudapi.com', { ...payload, Signature: signature }, { timeout: config.timeout ?? 15000 });
      const error = response.data?.Response?.Error;
      if (error) throw new Error(String(error.Message || error.Code));
    } catch (error) {
      throw new SmsChannelError(SmsErrorCode.CHANNEL_REQUEST_FAILED, '腾讯云短信发送失败', error);
    }
  }

  async testConnection(config: TencentSmsConfig): Promise<void> {
    await this.validateConfig(config);
  }

  private isSecureEndpoint(value: string): boolean {
    try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.search && !url.hash; } catch { return false; }
  }
}
