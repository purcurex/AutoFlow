import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiPromptTemplateEntity } from './ai-prompt-template.entity'
import { AiPromptBindingEntity } from './ai-prompt-binding.entity'
import { PromptTemplateService } from './prompt-template.service'
import { AiOutreachConversationEntity } from './ai-outreach-conversation.entity'
import { AiOutreachMessageEntity } from './ai-outreach-message.entity'
import { OutreachDraftVersionEntity } from './outreach-draft-version.entity'
import { LeadEntity } from '../autoflow/entities/lead.entity'
import { OutreachTaskEntity } from '../autoflow/entities/outreach-task.entity'
import { OutreachConversationService } from './outreach-conversation.service'

@Module({
  imports: [TypeOrmModule.forFeature([
    AiPromptTemplateEntity,
    AiPromptBindingEntity,
    AiOutreachConversationEntity,
    AiOutreachMessageEntity,
    OutreachDraftVersionEntity,
    LeadEntity,
    OutreachTaskEntity,
  ])],
  controllers: [AiController],
  providers: [AiService, PromptTemplateService, OutreachConversationService],
  exports: [AiService, PromptTemplateService, OutreachConversationService],
})
export class AiModule {}
