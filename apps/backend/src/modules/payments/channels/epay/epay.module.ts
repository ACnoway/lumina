import { Module } from '@nestjs/common';
import { EpayPaymentAdapter } from './epay.adapter';

@Module({ providers: [EpayPaymentAdapter], exports: [EpayPaymentAdapter] })
export class EpayPaymentModule {}
