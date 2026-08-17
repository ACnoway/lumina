import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { MinioModule } from '../../minio/minio.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdaptersModule } from '../chat/adapters/adapters.module';

@Module({
  imports: [
    PrismaModule,
    MinioModule,
    WalletModule,
    ProvidersModule,
    AdaptersModule,
  ],
  controllers: [ImageController],
  providers: [ImageService],
  exports: [ImageService],
})
export class ImageModule {}
