import { Module } from '@nestjs/common'
import { AutoflowController } from './autoflow.controller'
import { AutoflowService } from './autoflow.service'

@Module({
  controllers: [AutoflowController],
  providers: [AutoflowService],
  exports: [AutoflowService],
})
export class AutoflowModule {}
