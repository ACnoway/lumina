import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MinioModule } from './minio/minio.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ChatModule } from './modules/chat/chat.module';
import { ImageModule } from './modules/image/image.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    // 全局配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // 全局限流模块
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60秒
        limit: 100, // 最多100次请求
      },
    ]),

    // 基础设施模块
    PrismaModule,
    RedisModule,
    MinioModule,

    // 业务模块
    AuthModule,
    UsersModule,
    WalletModule,
    ProvidersModule,
    ChatModule,
    ImageModule,
    AdminModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
