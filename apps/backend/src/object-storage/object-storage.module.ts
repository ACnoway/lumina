import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ObjectStorageService } from './object-storage.service';

@Module({
  imports: [PrismaModule],
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
