import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuditModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
