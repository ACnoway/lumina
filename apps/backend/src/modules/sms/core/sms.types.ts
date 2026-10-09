import { SmsChannelType } from '@prisma/client';

export type SmsPurpose = 'login' | 'register' | 'bind';

export interface SmsChannelMetadata {
  type: SmsChannelType;
  name: string;
  capabilities: {
    send: boolean;
    testConnection: boolean;
  };
}

export interface SmsChannelAdapter<TConfig = Record<string, unknown>> {
  readonly type: SmsChannelType;
  getMetadata(): SmsChannelMetadata;
  validateConfig(config: TConfig): Promise<void>;
  getPublicConfig(config: TConfig): Record<string, unknown>;
  sendVerificationCode(phone: string, code: string, purpose: SmsPurpose, config: TConfig): Promise<void>;
  testConnection(config: TConfig): Promise<void>;
}
