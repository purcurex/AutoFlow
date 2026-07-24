import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { GenerateAiTextDto, SuggestTagsDto } from './dto/ai.dto'
import { AiService } from './ai.service'
import { PromptTemplateService } from './prompt-template.service'
import { ActivatePromptTemplateDto, CreatePromptTemplateDto, UpdatePromptTemplateDto } from './dto/prompt-template.dto'
import type { AiPromptModuleKey } from './prompt-template.types'
import { OutreachConversationService } from './outreach-conversation.service'
import {
  CreateOutreachConversationDto,
  ListOutreachConversationsQueryDto,
  SendOutreachConversationMessageDto,
  UpdateOutreachDraftDto,
} from './dto/outreach-conversation.dto'

@Controller('ai')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly outreachConversationService: OutreachConversationService,
  ) {}

  @Get('outreach-conversations')
  listOutreachConversations(
    @Request() req: ExpressRequest,
    @Query() query: ListOutreachConversationsQueryDto,
  ) {
    return this.outreachConversationService.list(req.user!.userId, query.leadId)
  }

  @Post('outreach-conversations')
  createOutreachConversation(
    @Request() req: ExpressRequest,
    @Body() body: CreateOutreachConversationDto,
  ) {
    return this.outreachConversationService.create(req.user!.userId, body)
  }

  @Get('outreach-conversations/:id')
  getOutreachConversation(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.outreachConversationService.get(req.user!.userId, id)
  }

  @Post('outreach-conversations/:id/messages')
  sendOutreachConversationMessage(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendOutreachConversationMessageDto,
  ) {
    return this.outreachConversationService.sendMessage(req.user!.userId, id, body.content)
  }

  @Post('outreach-conversations/:id/drafts')
  generateOutreachDraft(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.outreachConversationService.generateDraft(req.user!.userId, id)
  }

  @Patch('outreach-drafts/:id')
  updateOutreachDraft(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOutreachDraftDto,
  ) {
    return this.outreachConversationService.updateDraft(req.user!.userId, id, body)
  }

  @Post('outreach-drafts/:id/accept')
  acceptOutreachDraft(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.outreachConversationService.acceptDraft(req.user!.userId, id)
  }

  @Get('prompt-modules')
  listPromptModules(@Request() req: ExpressRequest) {
    return this.promptTemplateService.listModules(req.user!.userId)
  }

  @Post('prompt-templates')
  createPromptTemplate(@Request() req: ExpressRequest, @Body() body: CreatePromptTemplateDto) {
    return this.promptTemplateService.create(req.user!.userId, body)
  }

  @Patch('prompt-templates/:id')
  updatePromptTemplate(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromptTemplateDto,
  ) {
    return this.promptTemplateService.update(req.user!.userId, id, body)
  }

  @Delete('prompt-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePromptTemplate(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.promptTemplateService.remove(req.user!.userId, id)
  }

  @Put('prompt-modules/:moduleKey/active')
  @HttpCode(HttpStatus.NO_CONTENT)
  activatePromptTemplate(
    @Request() req: ExpressRequest,
    @Param('moduleKey') moduleKey: string,
    @Body() body: ActivatePromptTemplateDto,
  ) {
    return this.promptTemplateService.activate(req.user!.userId, moduleKey as AiPromptModuleKey, body.templateId)
  }

  @Post('generate')
  async generate(@Body() body: GenerateAiTextDto) {
    const { action, content, context } = body
    let result: string

    switch (action) {
      case 'continue':
        result = await this.aiService.continueWriting(content)
        break
      case 'polish':
        result = await this.aiService.polishText(content)
        break
      case 'summarize':
        result = await this.aiService.summarize(content)
        break
      case 'translate':
        result = await this.aiService.translate(content, context || '英文')
        break
      default:
        result = await this.aiService.generateText(content, context)
    }

    return { result }
  }

  @Post('suggest-tags')
  async suggestTags(@Body() body: SuggestTagsDto) {
    const tags = await this.aiService.suggestTags(body.content)
    return { tags }
  }
}
