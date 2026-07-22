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
  WorkflowJobEntity,
} from './entities'
import { DiscoveryModule } from '../discovery/discovery.module'
import { AiModule } from '../ai/ai.module'

@Module({
  imports: [
    DiscoveryModule,
    AiModule,
    TypeOrmModule.forFeature([
      WorkflowRunEntity,
      WorkflowStepEntity,
      WorkflowLeadEntity,
      LeadEntity,
      LeadContactEntity,
      OutreachTaskEntity,
      CrmActivityEntity,
      LeadScoreEntity,
      WorkflowJobEntity,
    ]),
  ],
  controllers: [AutoflowController],
  providers: [AutoflowService],
  exports: [AutoflowService],
})
export class AutoflowModule {}
