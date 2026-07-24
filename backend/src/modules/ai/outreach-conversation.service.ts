import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import {
  type OutreachChannel,
} from '../autoflow/autoflow.types'
import { LeadEntity } from '../autoflow/entities/lead.entity'
import { OutreachTaskEntity } from '../autoflow/entities/outreach-task.entity'
import type { LeadContactEntity } from '../autoflow/entities/lead-contact.entity'
import { AiService } from './ai.service'
import {
  AiOutreachConversationEntity,
  type AiOutreachConversationOptions,
} from './ai-outreach-conversation.entity'
import { AiOutreachMessageEntity } from './ai-outreach-message.entity'
import { OutreachDraftVersionEntity } from './outreach-draft-version.entity'
import { PromptTemplateService } from './prompt-template.service'
import type { AiPromptModuleKey } from './prompt-template.types'
import {
  CreateOutreachConversationDto,
  UpdateOutreachDraftDto,
} from './dto/outreach-conversation.dto'

const DEFAULT_OFFER = 'low-MOQ sourcing, fulfillment coordination, and product testing support'

@Injectable()
export class OutreachConversationService {
  constructor(
    @InjectRepository(AiOutreachConversationEntity)
    private readonly conversationRepository: Repository<AiOutreachConversationEntity>,
    @InjectRepository(AiOutreachMessageEntity)
    private readonly messageRepository: Repository<AiOutreachMessageEntity>,
    @InjectRepository(OutreachDraftVersionEntity)
    private readonly draftRepository: Repository<OutreachDraftVersionEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(OutreachTaskEntity)
    private readonly outreachRepository: Repository<OutreachTaskEntity>,
    private readonly dataSource: DataSource,
    private readonly aiService: AiService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  async create(ownerUserId: string, data: CreateOutreachConversationDto) {
    const lead = await this.leadRepository.findOne({
      where: { id: data.leadId, ownerUserId },
      relations: { contacts: true },
    })
    if (!lead) throw new NotFoundException('Lead not found')
    const options = this.buildOptions(data)
    this.validateOptions(options)
    const conversation = await this.conversationRepository.save(
      this.conversationRepository.create({
        ownerUserId,
        leadId: lead.id,
        title: `${lead.brandName} / ${options.channel}`,
        status: 'active',
        options,
        contextSnapshot: this.buildContextSnapshot(lead),
        summary: null,
        lastDraftVersion: 0,
      }),
    )
    await this.messageRepository.save(this.messageRepository.create({
      conversationId: conversation.id,
      ownerUserId,
      role: 'assistant',
      sequence: 1,
      content: options.responseLanguage === 'en'
        ? `I loaded the verified context for ${lead.brandName}. Tell me the product, value proposition, tone, or call to action you want to refine.`
        : `已载入 ${lead.brandName} 的已核实客户信息。请告诉我希望重点沟通的产品、卖点、语气或行动引导，我会协助逐步完善。`,
      metadata: { kind: 'welcome' },
    }))
    return this.get(ownerUserId, conversation.id)
  }

  async list(ownerUserId: string, leadId: string) {
    const conversations = await this.conversationRepository.find({
      where: { ownerUserId, leadId },
      relations: { messages: true, drafts: true },
      order: { updatedAt: 'DESC' },
      take: 20,
    })
    return conversations.map((conversation) => this.mapConversation(conversation))
  }

  async get(ownerUserId: string, id: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id, ownerUserId },
      relations: { messages: true, drafts: true },
    })
    if (!conversation) throw new NotFoundException('Outreach conversation not found')
    return this.mapConversation(conversation)
  }

  async sendMessage(ownerUserId: string, id: string, content: string) {
    const conversation = await this.getEntity(ownerUserId, id)
    if (conversation.status === 'accepted' || conversation.status === 'archived') {
      throw new ConflictException('Accepted or archived conversations cannot be changed')
    }
    const userMessage = await this.appendMessage(ownerUserId, id, 'user', content.trim())
    const messages = await this.messageRepository.find({
      where: { conversationId: id, ownerUserId },
      order: { sequence: 'ASC' },
      take: 40,
    })
    const promptModules = await this.resolvePromptModules(ownerUserId, conversation)
    const answer = await this.aiService.continueOutreachConversation({
      responseLanguage: conversation.options.responseLanguage,
      contextSnapshot: conversation.contextSnapshot,
      options: conversation.options,
      promptModules,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
    })
    const assistantMessage = await this.appendMessage(ownerUserId, id, 'assistant', answer)
    conversation.status = 'active'
    await this.conversationRepository.save(conversation)
    return {
      userMessage: this.mapMessage(userMessage),
      assistantMessage: this.mapMessage(assistantMessage),
    }
  }

  async generateDraft(ownerUserId: string, id: string) {
    const conversation = await this.getEntity(ownerUserId, id)
    if (conversation.status === 'accepted' || conversation.status === 'archived') {
      throw new ConflictException('Accepted or archived conversations cannot generate a new draft')
    }
    this.validateOptions(conversation.options)
    const messages = await this.messageRepository.find({
      where: { conversationId: id, ownerUserId },
      order: { sequence: 'ASC' },
      take: 40,
    })
    const promptModules = await this.resolvePromptModules(ownerUserId, conversation)
    const generated = await this.aiService.generateBilingualOutreach({
      contextSnapshot: conversation.contextSnapshot,
      options: conversation.options,
      promptModules,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
    })

    const draftId = await this.dataSource.transaction(async (manager) => {
      const conversations = manager.getRepository(AiOutreachConversationEntity)
      const drafts = manager.getRepository(OutreachDraftVersionEntity)
      const locked = await conversations.createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :id', { id })
        .andWhere('conversation.owner_user_id = :ownerUserId', { ownerUserId })
        .getOne()
      if (!locked) throw new NotFoundException('Outreach conversation not found')
      await drafts.update(
        { conversationId: id, ownerUserId, status: 'draft' },
        { status: 'superseded' },
      )
      const version = locked.lastDraftVersion + 1
      const draft = await drafts.save(drafts.create({
        conversationId: id,
        ownerUserId,
        leadId: locked.leadId,
        outreachTaskId: null,
        version,
        status: 'draft',
        englishSubject: generated.english.subject,
        englishMessage: generated.english.message,
        chineseSubject: generated.chinese.subject,
        chineseMessage: generated.chinese.message,
        factsUsed: generated.factsUsed,
        missingFacts: generated.missingFacts,
        warnings: generated.warnings,
      }))
      locked.lastDraftVersion = version
      locked.status = 'drafted'
      await conversations.save(locked)
      return draft.id
    })
    return this.getDraft(ownerUserId, draftId)
  }

  async updateDraft(ownerUserId: string, id: string, data: UpdateOutreachDraftDto) {
    const draft = await this.draftRepository.findOne({ where: { id, ownerUserId } })
    if (!draft) throw new NotFoundException('Outreach draft not found')
    if (draft.status !== 'draft') throw new ConflictException('Only draft versions can be edited')
    if (data.englishSubject !== undefined) draft.englishSubject = data.englishSubject.trim()
    if (data.englishMessage !== undefined) draft.englishMessage = data.englishMessage.trim()
    if (data.chineseSubject !== undefined) draft.chineseSubject = data.chineseSubject.trim()
    if (data.chineseMessage !== undefined) draft.chineseMessage = data.chineseMessage.trim()
    return this.mapDraft(await this.draftRepository.save(draft))
  }

  async acceptDraft(ownerUserId: string, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const drafts = manager.getRepository(OutreachDraftVersionEntity)
      const conversations = manager.getRepository(AiOutreachConversationEntity)
      const outreachTasks = manager.getRepository(OutreachTaskEntity)
      const leads = manager.getRepository(LeadEntity)
      const draft = await drafts.createQueryBuilder('draft')
        .setLock('pessimistic_write')
        .where('draft.id = :id', { id })
        .andWhere('draft.owner_user_id = :ownerUserId', { ownerUserId })
        .getOne()
      if (!draft) throw new NotFoundException('Outreach draft not found')
      if (draft.status === 'accepted' && draft.outreachTaskId) {
        return { draft: this.mapDraft(draft), outreachTaskId: draft.outreachTaskId }
      }
      if (draft.status !== 'draft') throw new ConflictException('Only the current draft can be accepted')
      if (!draft.englishMessage.trim() || !draft.chineseMessage.trim()) {
        throw new BadRequestException('Both English and Chinese messages are required')
      }
      const conversation = await conversations.findOne({
        where: { id: draft.conversationId, ownerUserId },
      })
      const lead = await leads.findOne({
        where: { id: draft.leadId, ownerUserId },
        relations: { contacts: true },
      })
      if (!conversation || !lead) throw new NotFoundException('Conversation context not found')
      const options = conversation.options
      const task = await outreachTasks.save(outreachTasks.create({
        leadId: lead.id,
        ownerUserId,
        teamId: lead.teamId,
        channel: options.channel,
        status: 'ready',
        message: draft.englishMessage,
        targetContact: options.manualTarget
          || this.selectContact(lead.contacts || [], options.channel),
        subject: options.channel === 'email' ? draft.englishSubject || null : null,
        templateKey: this.templateKey(options),
        templateOptions: options,
        nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        sentAt: null,
        repliedAt: null,
      }))
      await drafts.update(
        { conversationId: conversation.id, ownerUserId, status: 'draft' },
        { status: 'superseded' },
      )
      draft.status = 'accepted'
      draft.outreachTaskId = task.id
      await drafts.save(draft)
      conversation.status = 'accepted'
      await conversations.save(conversation)
      return { draft: this.mapDraft(draft), outreachTaskId: task.id }
    })
  }

  private async appendMessage(
    ownerUserId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const conversations = manager.getRepository(AiOutreachConversationEntity)
      const messages = manager.getRepository(AiOutreachMessageEntity)
      const conversation = await conversations.createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :conversationId', { conversationId })
        .andWhere('conversation.owner_user_id = :ownerUserId', { ownerUserId })
        .getOne()
      if (!conversation) throw new NotFoundException('Outreach conversation not found')
      const raw = await messages.createQueryBuilder('message')
        .select('MAX(message.sequence)', 'max')
        .where('message.conversation_id = :conversationId', { conversationId })
        .getRawOne<{ max: string | null }>()
      return messages.save(messages.create({
        conversationId,
        ownerUserId,
        role,
        sequence: Number(raw?.max || 0) + 1,
        content,
        metadata: {},
      }))
    })
  }

  private async getEntity(ownerUserId: string, id: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id, ownerUserId } })
    if (!conversation) throw new NotFoundException('Outreach conversation not found')
    return conversation
  }

  private async getDraft(ownerUserId: string, id: string) {
    const draft = await this.draftRepository.findOne({ where: { id, ownerUserId } })
    if (!draft) throw new NotFoundException('Outreach draft not found')
    return this.mapDraft(draft)
  }

  private buildOptions(data: CreateOutreachConversationDto): AiOutreachConversationOptions {
    return {
      channel: data.channel || 'facebook',
      manualTarget: data.manualTarget?.trim() || null,
      quoteMode: data.quoteMode || 'none',
      includeProductVisual: data.includeProductVisual ?? false,
      emphasizeSupplier: data.emphasizeSupplier ?? false,
      emphasizeLogistics: data.emphasizeLogistics ?? false,
      productImageUrl: data.productImageUrl?.trim() || null,
      verifiedQuoteContext: data.verifiedQuoteContext?.trim() || null,
      offer: data.offer?.trim() || DEFAULT_OFFER,
      responseLanguage: data.responseLanguage || 'zh-CN',
    }
  }

  private validateOptions(options: AiOutreachConversationOptions) {
    if (options.quoteMode !== 'none' && !options.verifiedQuoteContext) {
      throw new BadRequestException('Verified quote context is required for quote-based outreach')
    }
    if (options.includeProductVisual && !options.productImageUrl) {
      throw new BadRequestException('A product image URL is required when product visual is enabled')
    }
    if (options.channel === 'other' && !options.manualTarget) {
      throw new BadRequestException('A target is required for the other outreach channel')
    }
  }

  private buildContextSnapshot(lead: LeadEntity): Record<string, unknown> {
    return {
      leadId: lead.id,
      brandName: lead.brandName,
      domain: lead.domain,
      storeUrl: lead.storeUrl,
      productUrl: lead.productUrl,
      category: lead.category,
      country: lead.country,
      language: lead.language,
      recommendedAngle: lead.recommendedAngle,
      discoverySources: lead.discoverySources,
      scores: {
        shopifyConfidence: lead.shopifyConfidence,
        adActivity: lead.adActivityScore,
        traffic: lead.trafficScore,
        contact: lead.contactScore,
      },
      contacts: (lead.contacts || []).map((contact) => ({
        type: contact.type,
        label: contact.label,
        verified: contact.verified,
        verificationStatus: contact.verificationStatus,
      })),
      capturedAt: new Date().toISOString(),
    }
  }

  private async resolvePromptModules(
    ownerUserId: string,
    conversation: AiOutreachConversationEntity,
  ) {
    const options = conversation.options
    const snapshot = conversation.contextSnapshot
    const text = (value: unknown) => typeof value === 'string' ? value : null
    const moduleKeys: AiPromptModuleKey[] = [
      'outreach_base',
      `channel_${options.channel}` as AiPromptModuleKey,
      `quote_${options.quoteMode}` as AiPromptModuleKey,
      ...(options.includeProductVisual ? ['product_visual' as const] : []),
      ...(options.emphasizeSupplier ? ['supplier_strength' as const] : []),
      ...(options.emphasizeLogistics ? ['logistics_strength' as const] : []),
    ]
    return this.promptTemplateService.resolve(ownerUserId, moduleKeys, {
      channel: options.channel,
      language: 'English and Simplified Chinese',
      brandName: text(snapshot.brandName),
      domain: text(snapshot.domain),
      category: text(snapshot.category),
      country: text(snapshot.country),
      evidenceSummary: text(snapshot.recommendedAngle),
      offer: options.offer,
      quoteContext: options.verifiedQuoteContext,
      productImageUrl: options.productImageUrl,
    })
  }

  private selectContact(contacts: LeadContactEntity[], channel: OutreachChannel): string | null {
    const selected = contacts.find((contact) => contact.type === channel && contact.isPrimary)
      || contacts.find((contact) => contact.type === channel && contact.verified)
      || contacts.find((contact) => contact.type === channel)
    return selected?.value || null
  }

  private templateKey(options: AiOutreachConversationOptions): string {
    return [
      options.channel,
      options.quoteMode,
      options.includeProductVisual ? 'visual' : null,
      options.emphasizeSupplier ? 'supplier' : null,
      options.emphasizeLogistics ? 'logistics' : null,
      'bilingual',
    ].filter(Boolean).join(':')
  }

  private mapConversation(conversation: AiOutreachConversationEntity) {
    return {
      id: conversation.id,
      leadId: conversation.leadId,
      title: conversation.title,
      status: conversation.status,
      options: conversation.options,
      contextSnapshot: conversation.contextSnapshot,
      summary: conversation.summary,
      lastDraftVersion: conversation.lastDraftVersion,
      messages: [...(conversation.messages || [])]
        .sort((left, right) => left.sequence - right.sequence)
        .map((message) => this.mapMessage(message)),
      drafts: [...(conversation.drafts || [])]
        .sort((left, right) => right.version - left.version)
        .map((draft) => this.mapDraft(draft)),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    }
  }

  private mapMessage(message: AiOutreachMessageEntity) {
    return {
      id: message.id,
      role: message.role,
      sequence: message.sequence,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    }
  }

  private mapDraft(draft: OutreachDraftVersionEntity) {
    return {
      id: draft.id,
      conversationId: draft.conversationId,
      version: draft.version,
      status: draft.status,
      outreachTaskId: draft.outreachTaskId,
      englishSubject: draft.englishSubject,
      englishMessage: draft.englishMessage,
      chineseSubject: draft.chineseSubject,
      chineseMessage: draft.chineseMessage,
      factsUsed: draft.factsUsed,
      missingFacts: draft.missingFacts,
      warnings: draft.warnings,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    }
  }
}
