import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, RolesGuard],
  exports: [ProvidersService],
})
export class ProvidersModule {}
