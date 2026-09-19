import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { WalletModule } from '../wallet/wallet.module';
import { AlipayPaymentAdapter } from './channels/alipay/alipay.adapter';
import { EpayPaymentAdapter } from './channels/epay/epay.adapter';
import { WechatPaymentAdapter } from './channels/wechat/wechat.adapter';
import { PaymentAdapterRegistry, PAYMENT_ADAPTERS } from './core/payment-adapter.registry';
import { AdminPaymentChannelsController } from './controllers/admin-payment-channels.controller';
import { PaymentNotifyController } from './controllers/payment-notify.controller';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentChannelService } from './services/payment-channel.service';
import { PaymentConfigCryptoService } from './services/payment-config-crypto.service';
import { PaymentService } from './services/payment.service';

@Module({
  imports: [PrismaModule, WalletModule, SettingsModule, AuditModule],
  controllers: [PaymentsController, PaymentNotifyController, AdminPaymentChannelsController],
  providers: [
    EpayPaymentAdapter,
    AlipayPaymentAdapter,
    WechatPaymentAdapter,
    {
      provide: PAYMENT_ADAPTERS,
      inject: [EpayPaymentAdapter, AlipayPaymentAdapter, WechatPaymentAdapter],
      useFactory: (
        epay: EpayPaymentAdapter,
        alipay: AlipayPaymentAdapter,
        wechat: WechatPaymentAdapter,
      ) => [epay, alipay, wechat],
    },
    PaymentAdapterRegistry,
    PaymentChannelService,
    PaymentConfigCryptoService,
    PaymentService,
  ],
  exports: [PaymentService],
})
export class PaymentsModule {}
