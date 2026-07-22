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
  LeadScoreEntity,
} from './entities'
import { DiscoveryModule } from '../discovery/discovery.module'

@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([
      WorkflowRunEntity,
      WorkflowStepEntity,
      WorkflowLeadEntity,
      LeadEntity,
      LeadContactEntity,
      OutreachTaskEntity,
      CrmActivityEntity,
      LeadScoreEntity,
    ]),
  ],
  controllers: [AutoflowController],
  providers: [AutoflowService],
  exports: [AutoflowService],
})
export class AutoflowModule {}
