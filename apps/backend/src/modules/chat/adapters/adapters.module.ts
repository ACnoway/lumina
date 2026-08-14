import { Module } from '@nestjs/common';
import { AdapterFactory } from './adapter-factory';

@Module({
  providers: [AdapterFactory],
  exports: [AdapterFactory],
})
export class AdaptersModule {}
