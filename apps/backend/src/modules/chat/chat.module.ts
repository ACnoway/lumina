import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdaptersModule } from './adapters/adapters.module';

@Module({
  imports: [PrismaModule, AdaptersModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
