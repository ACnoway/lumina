import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { MinioModule } from '../../minio/minio.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdaptersModule } from '../chat/adapters/adapters.module';
import { RedisModule } from '../../redis/redis.module';
import { ImageQueueService } from './image-queue.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    MinioModule,
    WalletModule,
    ProvidersModule,
    AdaptersModule,
    RedisModule,
    SettingsModule,
  ],
  controllers: [ImageController],
  providers: [ImageService, ImageQueueService],
  exports: [ImageService],
})
export class ImageModule {}
