import { Injectable, Logger } from '@nestjs/common';
import { SmsChannelType } from '@prisma/client';
import { RedisService } from '../../../../redis/redis.service';
import { normalizePhone } from '../../../auth/phone.util';
import { SmsChannelAdapter, SmsChannelMetadata, SmsPurpose } from '../../core/sms.types';

@Injectable()
export class MockSmsAdapter implements SmsChannelAdapter {
  readonly type = SmsChannelType.MOCK;
  private readonly logger = new Logger(MockSmsAdapter.name);

  constructor(private readonly redis: RedisService) {}

  getMetadata(): SmsChannelMetadata {
    return {
      type: this.type,
      name: 'Mock 短信',
      capabilities: { send: true, testConnection: true },
    };
  }

  async validateConfig(): Promise<void> {}

  getPublicConfig(): Record<string, unknown> {
    return { mode: 'test', codeStoredInRedis: true };
  }

  async sendVerificationCode(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    const normalized = normalizePhone(phone);
    await this.redis.set(`sms:mock:last-code:${normalized}`, code, 300);
    await this.redis.set(
      `sms:mock:last-message:${normalized}`,
      JSON.stringify({ phone: normalized, code, purpose, sentAt: new Date().toISOString() }),
      300,
    );
    this.logger.log(`Mock SMS sent to ${normalized.slice(0, 3)}****${normalized.slice(-4)}`);
  }

  async testConnection(): Promise<void> {}
}
