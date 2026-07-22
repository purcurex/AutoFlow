import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AutoflowController } from './autoflow.controller'
import { AutoflowService } from './autoflow.service'
import {
  CrmActivityEntity,
  LeadContactEntity,
  LeadEntity,
  OutreachTaskEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
  WorkflowLeadEntity,
} from './entities'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowRunEntity,
      WorkflowStepEntity,
      WorkflowLeadEntity,
      LeadEntity,
      LeadContactEntity,
      OutreachTaskEntity,
      CrmActivityEntity,
    ]),
  ],
  controllers: [AutoflowController],
  providers: [AutoflowService],
  exports: [AutoflowService],
})
export class AutoflowModule {}
