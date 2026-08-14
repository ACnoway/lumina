import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdaptersModule } from './adapters/adapters.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [PrismaModule, AdaptersModule, WalletModule, ProvidersModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
