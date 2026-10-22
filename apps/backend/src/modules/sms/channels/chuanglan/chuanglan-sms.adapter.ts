import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash, randomInt } from 'crypto';
import { SmsChannelType } from '@prisma/client';
import { maskSecret } from '../../../auth/phone.util';
import { SmsChannelAdapter, SmsChannelMetadata, SmsPurpose } from '../../core/sms.types';
import { SmsChannelError, SmsErrorCode } from '../../core/sms.errors';

const DEFAULT_ENDPOINT = 'https://smssh.253.com';
const SEND_PATH = '/sms/v2/batch-send';
const NONCE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export interface ChuanglanSmsConfig {
  appId: string;
  appSecret: string;
  templateCode: string;
  endpoint?: string;
  timeout?: number;
}

interface ChuanglanSendResponse {
  code?: string;
  msg?: string;
  data?: {
    failNum?: string | number;
    successNum?: string | number;
    msgId?: string;
  } | null;
}

@Injectable()
export class ChuanglanSmsAdapter implements SmsChannelAdapter<ChuanglanSmsConfig> {
  readonly type = SmsChannelType.CHUANGLAN;

  getMetadata(): SmsChannelMetadata {
    return { type: this.type, name: '创蓝短信', capabilities: { send: true, testConnection: true } };
  }

  async validateConfig(config: ChuanglanSmsConfig): Promise<void> {
    if (!config?.appId?.trim() || !config.appSecret?.trim() || !config.templateCode?.trim()) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '创蓝短信 appId、appSecret、templateCode 不能为空');
    }
    if (config.endpoint && !this.isSecureEndpoint(config.endpoint)) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '创蓝短信 endpoint 必须为 HTTPS 基础地址，且不能包含查询参数或片段');
    }
    if (config.timeout !== undefined && (!Number.isInteger(config.timeout) || config.timeout < 1)) {
      throw new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '创蓝短信 timeout 必须为正整数毫秒');
    }
  }

  getPublicConfig(config: ChuanglanSmsConfig): Record<string, unknown> {
    return {
      appId: maskSecret(config.appId),
      templateCode: config.templateCode,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      secretConfigured: Boolean(config.appSecret),
    };
  }

  async sendVerificationCode(phone: string, code: string, _purpose: SmsPurpose, config: ChuanglanSmsConfig): Promise<void> {
    await this.validateConfig(config);
    const nonce = this.createNonce();
    const curTime = Math.floor(Date.now() / 1000).toString();
    const checkSum = createHash('sha1').update(`${config.appSecret}${nonce}${curTime}`).digest('hex');
    const body = {
      productType: 'verify',
      phoneNumbers: phone,
      templateCode: config.templateCode,
      templateParam: JSON.stringify([{ param1: code }]),
    };

    try {
      const response = await axios.post<ChuanglanSendResponse>(
        `${(config.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')}${SEND_PATH}`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            AppID: config.appId,
            Nonce: nonce,
            CurTime: curTime,
            CheckSum: checkSum,
          },
          timeout: config.timeout ?? 15000,
        },
      );
      if (response.data?.code !== '000000') {
        throw new Error(`code=${response.data?.code ?? 'unknown'} msg=${response.data?.msg ?? 'empty response'}`);
      }
      const successNum = Number(response.data.data?.successNum ?? 0);
      const failNum = Number(response.data.data?.failNum ?? 0);
      if (!Number.isFinite(successNum) || !Number.isFinite(failNum) || successNum < 1 || failNum > 0) {
        throw new Error(`创蓝未确认短信发送成功: successNum=${successNum} failNum=${failNum}`);
      }
    } catch (error) {
      throw new SmsChannelError(SmsErrorCode.CHANNEL_REQUEST_FAILED, '创蓝短信发送失败', error);
    }
  }

  async testConnection(config: ChuanglanSmsConfig): Promise<void> {
    await this.validateConfig(config);
  }

  private createNonce(): string {
    return Array.from({ length: 32 }, () => NONCE_CHARS[randomInt(NONCE_CHARS.length)]).join('');
  }

  private isSecureEndpoint(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }
}
