import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { AdminSmsChannelsController } from './controllers/admin-sms-channels.controller';
import { AliyunSmsAdapter } from './channels/aliyun/aliyun-sms.adapter';
import { TencentSmsAdapter } from './channels/tencent/tencent-sms.adapter';
import { MockSmsAdapter } from './channels/mock/mock-sms.adapter';
import { SmsAdapterRegistry, SMS_ADAPTERS } from './core/sms-adapter.registry';
import { SmsChannelService } from './services/sms-channel.service';
import { SmsConfigCryptoService } from './services/sms-config-crypto.service';

@Module({
  imports: [PrismaModule, RedisModule, AuditModule],
  controllers: [AdminSmsChannelsController],
  providers: [
    MockSmsAdapter,
    AliyunSmsAdapter,
    TencentSmsAdapter,
    {
      provide: SMS_ADAPTERS,
      inject: [MockSmsAdapter, AliyunSmsAdapter, TencentSmsAdapter],
      useFactory: (mock: MockSmsAdapter, aliyun: AliyunSmsAdapter, tencent: TencentSmsAdapter) => [mock, aliyun, tencent],
    },
    SmsAdapterRegistry,
    SmsChannelService,
    SmsConfigCryptoService,
  ],
  exports: [SmsChannelService],
})
export class SmsModule {}
