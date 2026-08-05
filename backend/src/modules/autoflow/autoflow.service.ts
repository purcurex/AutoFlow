import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import {
  CreateWorkflowDto,
  CreateWorkflowRevisionDto,
  GenerateMessageDto,
  ListLeadsQueryDto,
  ListOutreachTasksQueryDto,
  ListWorkflowsQueryDto,
  UpdateLeadStatusDto,
  UpdateOutreachTaskDto,
} from './dto/autoflow.dto'
import {
  AutoFlowDashboard,
  DEFAULT_GOOGLE_SEARCH_OPTIONS,
  FollowUpStage,
  LEAD_STATUS_TRANSITIONS,
  LeadStatus,
  OUTREACH_STATUS_TRANSITIONS,
  OutreachChannel,
  OutreachTemplateOptions,
  OutreachTask,
  PaginatedResult,
  StoreLead,
  WORKFLOW_STAGES,
  WorkflowDeletionImpact,
  WorkflowFailureCode,
  WorkflowFailureProvider,
  WorkflowRun,
} from './autoflow.types'
import {
  CrmActivityEntity,
  LeadEntity,
  LeadContactEntity,
  LeadScoreEntity,
  OutreachTaskEntity,
  WorkflowRunEntity,
  WorkflowJobEntity,
  WorkflowLeadEntity,
  WorkflowStepEntity,
} from './entities'
import { AiService } from '../ai/ai.service'
import { PromptTemplateService } from '../ai/prompt-template.service'
import type { AiPromptModuleKey } from '../ai/prompt-template.types'
import { StorefrontEnrichmentService } from '../discovery/storefront-enrichment.service'
import type { NormalizedContactEvidence, NormalizedShopifyStore } from '../discovery/discovery.types'
import { calculateContactScore } from '../discovery/contact-scoring'
import { User } from '../users/user.entity'
import { WorkflowSeedAssetService } from './workflow-seed-asset.service'
import { deriveCustomerDiscoveryStatus } from './customer-discovery-status'

@Injectable()
export class AutoflowService {
  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkflowStepEntity)
    private readonly workflowStepRepository: Repository<WorkflowStepEntity>,
    @InjectRepository(WorkflowJobEntity)
    private readonly workflowJobRepository: Repository<WorkflowJobEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(OutreachTaskEntity)
    private readonly outreachRepository: Repository<OutreachTaskEntity>,
    @InjectRepository(CrmActivityEntity)
    private readonly activityRepository: Repository<CrmActivityEntity>,
    private readonly dataSource: DataSource,
    private readonly aiService: AiService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly storefrontEnrichmentService: StorefrontEnrichmentService,
    private readonly workflowSeedAssetService: WorkflowSeedAssetService,
  ) {}

  async getDashboard(ownerUserId: string): Promise<AutoFlowDashboard> {
    const [activeWorkflows, newLeads, readyOutreach, replies, opportunities, workflows, leads, tasks, funnel] =
      await Promise.all([
        this.workflowRepository.count({ where: { ownerUserId, status: 'running', archivedAt: IsNull() } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'new' } }),
        this.outreachRepository.count({ where: { ownerUserId, status: 'ready' } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'replied' } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'opportunity' } }),
        this.workflowRepository.find({
          where: { ownerUserId, archivedAt: IsNull() },
          relations: { steps: true },
          order: { createdAt: 'DESC' },
          take: 5,
        }),
        this.leadRepository
          .createQueryBuilder('lead')
          .leftJoinAndSelect('lead.contacts', 'contact')
          .loadRelationCountAndMap('lead.discoveryCount', 'lead.workflowLinks')
          .where('lead.owner_user_id = :ownerUserId', { ownerUserId })
          .orderBy('lead.totalScore', 'DESC')
          .take(5)
          .getMany(),
        this.outreachRepository.find({
          where: { ownerUserId, status: 'ready' },
          relations: { lead: { contacts: true }, owner: true },
          order: { nextFollowUpAt: 'ASC', createdAt: 'DESC' },
          take: 5,
        }),
        this.getFollowUps(ownerUserId),
      ])

    return {
      metrics: { activeWorkflows, newLeads, readyOutreach, replies, opportunities },
      funnel,
      recentWorkflows: workflows.map((workflow) => this.mapWorkflow(workflow)),
      topLeads: leads.map((lead) => this.mapLead(lead)),
      nextTasks: tasks.map((task) => this.mapOutreachTask(task)),
    }
  }

  async getWorkflows(
    ownerUserId: string,
    query: ListWorkflowsQueryDto,
  ): Promise<PaginatedResult<WorkflowRun>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const [items, total] = await this.workflowRepository.findAndCount({
      where: { ownerUserId, archivedAt: IsNull() },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const workflowIds = items.map((workflow) => workflow.id)
    const [jobs, steps] = items.length > 0
      ? await Promise.all([
          this.workflowJobRepository.find({
            where: { ownerUserId, workflowRunId: In(workflowIds) },
          }),
          // 当前页一次性读取客户发现步骤，避免列表按工作流逐条查询产生 N+1。
          this.workflowStepRepository.find({
            where: {
              workflowRunId: In(workflowIds),
              stage: In(['ad_discovery', 'store_detection']),
            },
          }),
        ])
      : [[], []]
    const failureReasonByWorkflow = new Map(jobs.map((job) => [job.workflowRunId, job.lastError]))
    const stepsByWorkflow = new Map<string, WorkflowStepEntity[]>()
    for (const step of steps) {
      const workflowSteps = stepsByWorkflow.get(step.workflowRunId) || []
      workflowSteps.push(step)
      stepsByWorkflow.set(step.workflowRunId, workflowSteps)
    }
    return {
      items: items.map((workflow) => this.mapWorkflow(
        workflow,
        failureReasonByWorkflow.get(workflow.id) || null,
        stepsByWorkflow.get(workflow.id) || [],
      )),
      total,
      page,
      pageSize,
    }
  }

  async createWorkflow(ownerUserId: string, data: CreateWorkflowDto): Promise<WorkflowRun> {
    await this.validateWorkflowSeedAsset(ownerUserId, data)
    return this.dataSource.transaction(async (manager) => {
      const workflow = await this.createWorkflowRecord(manager, ownerUserId, data)
      return this.mapWorkflow(workflow)
    })
  }

  async getWorkflow(ownerUserId: string, id: string): Promise<WorkflowRun> {
    const workflow = await this.workflowRepository.findOne({ where: { id, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')
    const [job, steps] = await Promise.all([
      this.workflowJobRepository.findOne({ where: { workflowRunId: id, ownerUserId } }),
      this.workflowStepRepository.find({
        where: {
          workflowRunId: id,
          stage: In(['ad_discovery', 'store_detection']),
        },
      }),
    ])
    return this.mapWorkflow(workflow, job?.lastError || null, steps)
  }

  async getWorkflowDeletionImpact(ownerUserId: string, id: string): Promise<WorkflowDeletionImpact> {
    const workflow = await this.workflowRepository.findOne({ where: { id, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')

    const [associatedLeadCount, revisionCount] = await Promise.all([
      this.dataSource.getRepository(WorkflowLeadEntity).count({ where: { workflowRunId: id } }),
      this.workflowRepository.count({
        where: [
          { ownerUserId, parentWorkflowRunId: id },
          { ownerUserId, rootWorkflowRunId: id },
        ],
      }),
    ])
    const statusAllowsDelete = ['draft', 'failed', 'cancelled'].includes(workflow.status)
    const canDelete = statusAllowsDelete && revisionCount === 0
    return {
      workflowId: id,
      canDelete,
      requiresArchive: !canDelete,
      associatedLeadCount,
      preservedLeadCount: associatedLeadCount,
      revisionCount,
    }
  }

  async createWorkflowRevision(
    ownerUserId: string,
    sourceId: string,
    data: CreateWorkflowRevisionDto,
  ): Promise<WorkflowRun> {
    await this.validateWorkflowSeedAsset(ownerUserId, data)
    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const source = await workflowRepository.findOne({
        where: { id: sourceId, ownerUserId },
      })
      if (!source) throw new NotFoundException('Workflow not found')
      if (!['failed', 'cancelled', 'completed'].includes(source.status)) {
        throw new ConflictException(`Workflow cannot be revised from ${source.status}`)
      }

      const rootWorkflowRunId = source.rootWorkflowRunId || source.id
      await workflowRepository.createQueryBuilder('workflow')
        .setLock('pessimistic_write')
        .where('workflow.id = :rootWorkflowRunId', { rootWorkflowRunId })
        .andWhere('workflow.owner_user_id = :ownerUserId', { ownerUserId })
        .getOneOrFail()
      const rawMax = await workflowRepository.createQueryBuilder('workflow')
        .select('MAX(workflow.revision_no)', 'max')
        .where('workflow.owner_user_id = :ownerUserId', { ownerUserId })
        .andWhere('(workflow.id = :rootWorkflowRunId OR workflow.root_workflow_run_id = :rootWorkflowRunId)', {
          rootWorkflowRunId,
        })
        .getRawOne<{ max: string | null }>()
      const revisionNo = Number(rawMax?.max || source.revisionNo || 1) + 1
      const revised = await this.createWorkflowRecord(manager, ownerUserId, data, {
        parentWorkflowRunId: source.id,
        rootWorkflowRunId,
        revisionNo,
      })
      return this.mapWorkflow(revised)
    })
  }

  async archiveWorkflow(ownerUserId: string, id: string): Promise<WorkflowRun> {
    const workflow = await this.workflowRepository.findOne({ where: { id, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')
    if (workflow.status === 'running') throw new ConflictException('Running workflows cannot be archived')
    if (workflow.archivedAt) return this.mapWorkflow(workflow)
    workflow.archivedAt = new Date()
    return this.mapWorkflow(await this.workflowRepository.save(workflow))
  }

  async deleteWorkflow(
    ownerUserId: string,
    id: string,
  ): Promise<{ deleted: true; preservedLeadCount: number }> {
    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const workflow = await workflowRepository.createQueryBuilder('workflow')
        .setLock('pessimistic_write')
        .where('workflow.id = :id', { id })
        .andWhere('workflow.owner_user_id = :ownerUserId', { ownerUserId })
        .getOne()
      if (!workflow) throw new NotFoundException('Workflow not found')
      if (!['draft', 'failed', 'cancelled'].includes(workflow.status)) {
        throw new ConflictException('Only draft, failed, or cancelled workflows can be deleted')
      }

      const revisionCount = await workflowRepository.createQueryBuilder('workflow')
        .where('workflow.owner_user_id = :ownerUserId', { ownerUserId })
        .andWhere('(workflow.parent_workflow_run_id = :id OR workflow.root_workflow_run_id = :id)', { id })
        .getCount()
      if (revisionCount > 0) {
        throw new ConflictException('Workflow has revision history and must be archived')
      }
      const preservedLeadCount = await manager.getRepository(WorkflowLeadEntity)
        .count({ where: { workflowRunId: id } })
      await workflowRepository.remove(workflow)
      return { deleted: true, preservedLeadCount }
    })
  }

  async getLeads(ownerUserId: string, query: ListLeadsQueryDto): Promise<PaginatedResult<StoreLead>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const builder = this.leadRepository
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contacts', 'contact')
      .leftJoinAndSelect('lead.workflowRun', 'primaryWorkflow')
      .leftJoinAndSelect('lead.workflowLinks', 'workflowLink')
      .leftJoinAndSelect('workflowLink.workflowRun', 'discoveryWorkflow')
      .loadRelationCountAndMap('lead.discoveryCount', 'lead.workflowLinks')
      .where('lead.owner_user_id = :ownerUserId', { ownerUserId })
      .orderBy('lead.totalScore', 'DESC')
      .addOrderBy('lead.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    if (query.status) builder.andWhere('lead.status = :status', { status: query.status })
    if (query.workflowRunId) {
      builder.andWhere(
        '(lead.workflow_run_id = :workflowRunId OR workflowLink.workflow_run_id = :workflowRunId)',
        { workflowRunId: query.workflowRunId },
      )
    }
    if (query.search?.trim()) {
      builder.andWhere(
        '(lead.brand_name ILIKE :search OR lead.domain ILIKE :search OR lead.country ILIKE :search OR lead.category ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      )
    }

    const [items, total] = await builder.getManyAndCount()
    return { items: items.map((lead) => this.mapLead(lead)), total, page, pageSize }
  }

  async getLead(ownerUserId: string, id: string): Promise<StoreLead> {
    const lead = await this.leadRepository.findOne({
      where: { id, ownerUserId },
      relations: { contacts: true, workflowRun: true, workflowLinks: { workflowRun: true } },
    })
    if (!lead) throw new NotFoundException('Lead not found')
    const latestScore = await this.dataSource.getRepository(LeadScoreEntity).findOne({
      where: { leadId: id, ownerUserId },
      order: { calculatedAt: 'DESC' },
    })
    return this.mapLead(lead, latestScore?.reasons || null)
  }

  async analyzeLeadContacts(ownerUserId: string, id: string): Promise<StoreLead> {
    const lead = await this.leadRepository.findOne({
      where: { id, ownerUserId },
      relations: { contacts: true, workflowRun: true, workflowLinks: { workflowRun: true } },
    })
    if (!lead) throw new NotFoundException('Lead not found')

    const existingContacts: NormalizedContactEvidence[] = (lead.contacts || [])
      .filter((contact) => contact.type !== 'website' && contact.sourceUrl)
      .map((contact) => ({
        type: contact.type,
        value: contact.value,
        label: contact.label,
        sourceUrl: contact.sourceUrl!,
        sourceType: contact.sourceType,
        verificationStatus: contact.verificationStatus,
        confidence: contact.confidence,
        evidence: contact.evidence,
      }))
    const store: NormalizedShopifyStore = {
      name: lead.brandName,
      domain: lead.domain,
      normalizedDomain: lead.normalizedDomain,
      url: lead.storeUrl,
      productUrl: lead.productUrl,
      description: lead.recommendedAngle,
      imageUrl: null,
      detectionSource: 'manual_contact_analysis',
      discoverySources: lead.discoverySources || [],
      validityScore: Math.max(0, Math.min(100, lead.totalScore)),
      shopifyConfidence: lead.shopifyConfidence,
      verificationStatus: 'probable',
      verificationEvidence: {},
      verifiedAt: null,
      contacts: existingContacts,
      traffic: null,
      rawPayload: {},
    }
    const enriched = await this.storefrontEnrichmentService.enrichStore(store)
    const discovered = enriched.contacts.filter((contact) => contact.type !== 'website')
    if (discovered.length > 0) {
      const rows = discovered.map((contact, index) => this.dataSource.getRepository(LeadContactEntity).create({
        leadId: lead.id,
        type: contact.type,
        value: contact.value.slice(0, 500),
        label: contact.label,
        verified: contact.verificationStatus === 'verified',
        isPrimary: index === 0,
        sourceUrl: contact.sourceUrl.slice(0, 1000),
        sourceType: contact.sourceType,
        verificationStatus: contact.verificationStatus,
        confidence: contact.confidence,
        evidence: contact.evidence,
      }))
      await this.dataSource.getRepository(LeadContactEntity).upsert(
        rows as unknown as QueryDeepPartialEntity<LeadContactEntity>[],
        {
        conflictPaths: ['leadId', 'type', 'value'],
        skipUpdateIfNoValuesChanged: true,
        },
      )
    }
    const allContacts = await this.dataSource.getRepository(LeadContactEntity).find({
      where: { leadId: lead.id },
    })
    const contactScoreResult = calculateContactScore(allContacts)
    const previousContactScore = lead.contactScore
    lead.contactScore = contactScoreResult.score
    lead.totalScore = Math.max(0, Math.min(
      100,
      Math.round(lead.totalScore + (lead.contactScore - previousContactScore) * 0.25),
    ))
    await this.leadRepository.update(
      { id: lead.id, ownerUserId },
      { contactScore: lead.contactScore, totalScore: lead.totalScore },
    )

    const latestScore = await this.dataSource.getRepository(LeadScoreEntity).findOne({
      where: { leadId: lead.id, ownerUserId },
      order: { calculatedAt: 'DESC' },
    })
    if (latestScore) {
      latestScore.contactScore = lead.contactScore
      latestScore.totalScore = lead.totalScore
      latestScore.modelVersion = 'rules-v3-priority-contact-ads'
      latestScore.reasons = {
        ...(latestScore.reasons || {}),
        contactEvidenceCount: allContacts.filter((contact) => contact.type !== 'website').length,
        contactTypes: [...new Set(allContacts.map((contact) => contact.type))],
        priorityContactTypes: contactScoreResult.priorityTypes,
        priorityContactCount: contactScoreResult.priorityCount,
        hasOwnerFacebookProfile: contactScoreResult.hasOwnerFacebookProfile,
        emailOnlyCapApplied: contactScoreResult.emailOnlyCapApplied,
      }
      await this.dataSource.getRepository(LeadScoreEntity).save(latestScore)
    }
    return this.getLead(ownerUserId, id)
  }

  async updateLeadStatus(
    ownerUserId: string,
    id: string,
    data: UpdateLeadStatusDto,
  ): Promise<StoreLead> {
    await this.dataSource.transaction(async (manager) => {
      const leadRepository = manager.getRepository(LeadEntity)
      const activityRepository = manager.getRepository(CrmActivityEntity)
      const lead = await leadRepository.findOne({ where: { id, ownerUserId } })
      if (!lead) throw new NotFoundException('Lead not found')
      if (lead.status === data.status) return

      this.assertTransition('lead', lead.status, data.status, LEAD_STATUS_TRANSITIONS)
      const fromStatus = lead.status
      lead.status = data.status
      await leadRepository.save(lead)
      await activityRepository.save(
        activityRepository.create({
          leadId: lead.id,
          ownerUserId,
          teamId: lead.teamId,
          type: 'status_change',
          subject: 'Lead status updated',
          content: data.note?.trim() || `Lead moved from ${fromStatus} to ${data.status}`,
          fromStatus,
          toStatus: data.status,
          occurredAt: new Date(),
          nextFollowUpAt: null,
          metadata: null,
        }),
      )
    })
    return this.getLead(ownerUserId, id)
  }

  async generateMessage(
    ownerUserId: string,
    leadId: string,
    data: GenerateMessageDto,
  ): Promise<OutreachTask> {
    const lead = await this.leadRepository.findOne({
      where: { id: leadId, ownerUserId },
      relations: { contacts: true },
    })
    if (!lead) throw new NotFoundException('Lead not found')

    const channel = data.channel || 'facebook'
    const templateOptions: OutreachTemplateOptions = {
      quoteMode: data.quoteMode || 'none',
      includeProductVisual: data.includeProductVisual ?? false,
      emphasizeSupplier: data.emphasizeSupplier ?? false,
      emphasizeLogistics: data.emphasizeLogistics ?? false,
      productImageUrl: data.productImageUrl?.trim() || null,
      verifiedQuoteContext: data.verifiedQuoteContext?.trim() || null,
    }
    if (templateOptions.quoteMode !== 'none' && !templateOptions.verifiedQuoteContext) {
      throw new BadRequestException('Verified quote context is required for quote-based outreach.')
    }
    if (templateOptions.includeProductVisual && !templateOptions.productImageUrl) {
      throw new BadRequestException('A product image URL is required when the product visual module is enabled.')
    }
    const promptModuleKeys: AiPromptModuleKey[] = [
      'outreach_base',
      `channel_${channel}` as AiPromptModuleKey,
      `quote_${templateOptions.quoteMode}` as AiPromptModuleKey,
      ...(templateOptions.includeProductVisual ? ['product_visual' as const] : []),
      ...(templateOptions.emphasizeSupplier ? ['supplier_strength' as const] : []),
      ...(templateOptions.emphasizeLogistics ? ['logistics_strength' as const] : []),
    ]
    const promptModules = await this.promptTemplateService.resolve(ownerUserId, promptModuleKeys, {
      channel,
      language: data.language || lead.language || 'English',
      brandName: lead.brandName,
      domain: lead.domain,
      category: lead.category,
      country: lead.country,
      evidenceSummary: lead.recommendedAngle,
      offer: data.offer || 'low-MOQ sourcing, fast fulfillment, and product testing support',
      quoteContext: templateOptions.verifiedQuoteContext,
      productImageUrl: templateOptions.productImageUrl,
    })
    const targetContact = data.targetContact?.trim()
      || this.selectContact(lead.contacts || [], channel)
    const message = await this.aiService.generateSalesOutreach({
      channel,
      language: data.language || lead.language || 'English',
      brandName: lead.brandName,
      domain: lead.domain,
      category: lead.category,
      country: lead.country,
      evidenceSummary: lead.recommendedAngle,
      offer: data.offer || 'low-MOQ sourcing, fast fulfillment, and product testing support',
      ...templateOptions,
      promptModules,
    })

    const task = await this.outreachRepository.save(
      this.outreachRepository.create({
        leadId,
        ownerUserId,
        teamId: lead.teamId,
        channel,
        status: 'draft',
        message,
        targetContact,
        subject: channel === 'email' ? `Sourcing support for ${lead.brandName}` : null,
        templateKey: this.messageTemplateKey(channel, templateOptions),
        templateOptions,
        nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        sentAt: null,
        repliedAt: null,
      }),
    )
    return this.getOutreachTask(ownerUserId, task.id)
  }

  async getOutreachTasks(
    ownerUserId: string,
    query: ListOutreachTasksQueryDto,
  ): Promise<PaginatedResult<OutreachTask>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const builder = this.outreachRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.lead', 'lead')
      .leftJoinAndSelect('lead.contacts', 'leadContact')
      .leftJoinAndSelect('task.owner', 'owner')
      .where('task.owner_user_id = :ownerUserId', { ownerUserId })
      .orderBy('task.nextFollowUpAt', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    if (query.status) builder.andWhere('task.status = :status', { status: query.status })
    if (query.leadId) builder.andWhere('task.lead_id = :leadId', { leadId: query.leadId })

    const [items, total] = await builder.getManyAndCount()
    return { items: items.map((task) => this.mapOutreachTask(task)), total, page, pageSize }
  }

  async updateOutreachTask(
    ownerUserId: string,
    id: string,
    data: UpdateOutreachTaskDto,
  ): Promise<OutreachTask> {
    await this.dataSource.transaction(async (manager) => {
      const taskRepository = manager.getRepository(OutreachTaskEntity)
      const leadRepository = manager.getRepository(LeadEntity)
      const activityRepository = manager.getRepository(CrmActivityEntity)
      const task = await taskRepository.findOne({ where: { id, ownerUserId }, relations: { lead: true } })
      if (!task || task.lead.ownerUserId !== ownerUserId) {
        throw new NotFoundException('Outreach task not found')
      }

      if (data.status && data.status !== task.status) {
        this.assertTransition('outreach', task.status, data.status, OUTREACH_STATUS_TRANSITIONS)
        if (data.status === 'ready' && !(data.message ?? task.message).trim()) {
          throw new ConflictException('Outreach message must be reviewed before it becomes ready')
        }
        task.status = data.status
        if (data.status === 'sent') task.sentAt = new Date()
        if (data.status === 'replied') task.repliedAt = new Date()

        const nextLeadStatus = this.leadStatusForOutreach(data.status, task.lead.status)
        if (nextLeadStatus && nextLeadStatus !== task.lead.status) {
          const fromStatus = task.lead.status
          task.lead.status = nextLeadStatus
          await leadRepository.save(task.lead)
          await activityRepository.save(
            activityRepository.create({
              leadId: task.leadId,
              ownerUserId,
              teamId: task.teamId,
              type: 'status_change',
              subject: 'Outreach updated lead status',
              content: `Lead moved from ${fromStatus} to ${nextLeadStatus}`,
              fromStatus,
              toStatus: nextLeadStatus,
              occurredAt: new Date(),
              nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : task.nextFollowUpAt,
              metadata: { outreachTaskId: task.id, outreachStatus: data.status },
            }),
          )
        }
      }

      if (data.message !== undefined) task.message = data.message.trim()
      if (data.nextFollowUpAt !== undefined) task.nextFollowUpAt = new Date(data.nextFollowUpAt)
      await taskRepository.save(task)
    })
    return this.getOutreachTask(ownerUserId, id)
  }

  async getFollowUps(ownerUserId: string): Promise<FollowUpStage[]> {
    const counts = await this.leadRepository
      .createQueryBuilder('lead')
      .select('lead.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('lead.owner_user_id = :ownerUserId', { ownerUserId })
      .groupBy('lead.status')
      .getRawMany<{ status: LeadStatus; count: string }>()
    const countByStatus = new Map(counts.map((item) => [item.status, Number(item.count)]))
    const labels: Array<[LeadStatus, string]> = [
      ['new', 'New'],
      ['qualified', 'Qualified'],
      ['contacted', 'Contacted'],
      ['replied', 'Replied'],
      ['opportunity', 'Opportunity'],
      ['won', 'Won'],
      ['lost', 'Lost'],
      ['invalid', 'Invalid'],
    ]
    return labels.map(([key, label]) => ({ key, label, count: countByStatus.get(key) || 0, value: 0 }))
  }

  private async getOutreachTask(ownerUserId: string, id: string): Promise<OutreachTask> {
    const task = await this.outreachRepository.findOne({
      where: { id, ownerUserId },
      relations: { lead: { contacts: true }, owner: true },
    })
    if (!task) throw new NotFoundException('Outreach task not found')
    return this.mapOutreachTask(task)
  }

  private async createWorkflowRecord(
    manager: EntityManager,
    ownerUserId: string,
    data: CreateWorkflowDto,
    lifecycle: {
      parentWorkflowRunId: string
      rootWorkflowRunId: string
      revisionNo: number
    } | null = null,
  ): Promise<WorkflowRunEntity> {
    const workflowRepository = manager.getRepository(WorkflowRunEntity)
    const stepRepository = manager.getRepository(WorkflowStepEntity)
    const userRepository = manager.getRepository(User)
    const owner = await userRepository.createQueryBuilder('owner')
      .addSelect('owner.nextWorkflowNumber')
      .setLock('pessimistic_write')
      .where('owner.id = :ownerUserId', { ownerUserId })
      .getOne()
    if (!owner) throw new NotFoundException('Workflow owner not found')
    if (owner.nextWorkflowNumber > 999999) {
      throw new ConflictException('Workflow display ID limit reached')
    }
    const workflowNumber = owner.nextWorkflowNumber
    owner.nextWorkflowNumber += 1
    await userRepository.save(owner)

    const seedValue = data.seedValue.trim()
    const workflow = await workflowRepository.save(
      workflowRepository.create({
        displayId: workflowNumber < 100
          ? String(workflowNumber).padStart(2, '0')
          : String(workflowNumber),
        ownerUserId,
        teamId: null,
        parentWorkflowRunId: lifecycle?.parentWorkflowRunId || null,
        rootWorkflowRunId: lifecycle?.rootWorkflowRunId || null,
        revisionNo: lifecycle?.revisionNo || 1,
        name: data.name?.trim() || `${seedValue} prospect workflow`,
        seedType: data.seedType,
        seedValue,
        seedAssetPath: data.seedType === 'image' ? data.seedAssetPath || null : null,
        seedAssetMimeType: data.seedType === 'image' ? data.seedAssetMimeType || null : null,
        seedAssetSize: data.seedType === 'image' && data.seedAssetSize
          ? String(data.seedAssetSize)
          : null,
        seedAssetSha256: data.seedType === 'image' ? data.seedAssetSha256 || null : null,
        targetMarket: data.targetMarket?.trim() || 'United States',
        searchOptions: {
          ...DEFAULT_GOOGLE_SEARCH_OPTIONS,
          ...data.searchOptions,
        },
        status: 'draft',
        currentStage: 'seed',
        progress: 0,
        leadCount: 0,
        startedAt: null,
        completedAt: null,
        archivedAt: null,
      }),
    )

    await stepRepository.save(
      WORKFLOW_STAGES.map((stage, sequence) =>
        stepRepository.create({
          workflowRunId: workflow.id,
          stage,
          sequence,
          status: stage === 'seed' ? 'completed' : 'pending',
          input: stage === 'seed' ? { seedType: data.seedType, seedValue } : null,
          output: null,
          errorMessage: null,
          startedAt: stage === 'seed' ? workflow.createdAt : null,
          completedAt: stage === 'seed' ? workflow.createdAt : null,
        }),
      ),
    )
    return workflow
  }

  private assertTransition<T extends string>(
    subject: string,
    from: T,
    to: T,
    transitions: Record<T, readonly T[]>,
  ): void {
    if (!transitions[from].includes(to)) {
      throw new ConflictException(`Invalid ${subject} status transition: ${from} -> ${to}`)
    }
  }

  private leadStatusForOutreach(status: string, current: LeadStatus): LeadStatus | null {
    if (status === 'sent' && (current === 'new' || current === 'qualified')) return 'contacted'
    if (status === 'replied' && current === 'contacted') return 'replied'
    return null
  }

  private mapWorkflow(
    workflow: WorkflowRunEntity,
    failureReason: string | null = null,
    steps: WorkflowStepEntity[] = workflow.steps || [],
  ): WorkflowRun {
    const failure = this.classifyWorkflowFailure(failureReason)
    return {
      id: workflow.id,
      displayId: workflow.displayId,
      parentWorkflowRunId: workflow.parentWorkflowRunId,
      rootWorkflowRunId: workflow.rootWorkflowRunId,
      revisionNo: workflow.revisionNo,
      name: workflow.name,
      seedType: workflow.seedType,
      seedValue: workflow.seedValue,
      seedAssetPath: workflow.seedAssetPath || null,
      seedAssetMimeType: workflow.seedAssetMimeType || null,
      seedAssetSize: workflow.seedAssetSize || null,
      seedAssetSha256: workflow.seedAssetSha256 || null,
      targetMarket: workflow.targetMarket,
      searchOptions: {
        ...DEFAULT_GOOGLE_SEARCH_OPTIONS,
        ...(workflow.searchOptions || {}),
      },
      status: workflow.status,
      currentStage: workflow.currentStage,
      progress: workflow.progress,
      leadCount: workflow.leadCount,
      customerDiscoveryStatus: deriveCustomerDiscoveryStatus(workflow.status, steps),
      failureReason,
      failureCode: failure?.code || null,
      failureProvider: failure?.provider || null,
      failureRetryable: failure?.retryable || false,
      archivedAt: workflow.archivedAt?.toISOString() || null,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    }
  }

  /** 本地图片引用在进入事务前完成文件归属校验，外部HTTPS图片不带本地资产字段。 */
  private async validateWorkflowSeedAsset(
    ownerUserId: string,
    data: CreateWorkflowDto,
  ): Promise<void> {
    if (data.seedType !== 'image' || !data.seedAssetPath) return
    await this.workflowSeedAssetService.assertOwnedAsset(ownerUserId, data.seedAssetPath)
  }

  private classifyWorkflowFailure(failureReason: string | null): {
    code: WorkflowFailureCode
    provider: WorkflowFailureProvider | null
    retryable: boolean
  } | null {
    if (!failureReason) return null
    const provider = /pipiads/i.test(failureReason)
      ? 'pipiads'
      : /google lens/i.test(failureReason)
        ? 'google_lens'
        : /google search|serpapi/i.test(failureReason)
          ? 'google_search'
          : /PUBLIC_ASSET_BASE_URL|only available locally|publicly reachable/i.test(failureReason)
            ? 'customer_discovery'
            : null
    if (/442|credits? (are )?insufficient|balance|余额不足/i.test(failureReason)) {
      return { code: 'insufficient_credits', provider, retryable: false }
    }
    if (/image.*(fetch|download|unreachable|failed|only available locally)|获取图片失败|public[_\s]asset|publicly reachable/i.test(failureReason)) {
      return { code: 'image_unreachable', provider, retryable: false }
    }
    if (/no results|returned no|not returned any results|zero results/i.test(failureReason)) {
      return { code: 'no_results', provider, retryable: false }
    }
    if (/unavailable|timeout|timed out|temporarily|provider status|429|5\d\d/i.test(failureReason)) {
      return { code: 'provider_unavailable', provider, retryable: true }
    }
    return { code: 'unknown', provider, retryable: true }
  }

  private mapLead(lead: LeadEntity, scoreReasons: Record<string, unknown> | null = null): StoreLead {
    const discoveryCount = Math.max(lead.discoveryCount ?? lead.workflowLinks?.length ?? 1, 1)
    const workflowDiscoveries = (lead.workflowLinks || [])
      .filter((link) => Boolean(link.workflowRun))
      .map((link) => ({
        workflowRunId: link.workflowRunId,
        workflowDisplayId: link.workflowRun.displayId,
        workflowName: link.workflowRun.name,
        workflowCreatedAt: link.workflowRun.createdAt.toISOString(),
        discoveredAt: link.discoveredAt.toISOString(),
        score: link.sourceScore,
      }))
      .sort((left, right) => (
        right.score - left.score
        || new Date(right.discoveredAt).getTime() - new Date(left.discoveredAt).getTime()
      ))
    if (workflowDiscoveries.length === 0 && lead.workflowRun) {
      workflowDiscoveries.push({
        workflowRunId: lead.workflowRun.id,
        workflowDisplayId: lead.workflowRun.displayId,
        workflowName: lead.workflowRun.name,
        workflowCreatedAt: lead.workflowRun.createdAt.toISOString(),
        discoveredAt: lead.createdAt.toISOString(),
        score: lead.totalScore,
      })
    }

    return {
      id: lead.id,
      workflowRunId: lead.workflowRunId,
      brandName: lead.brandName,
      domain: lead.domain,
      storeUrl: lead.storeUrl,
      productUrl: lead.productUrl,
      ownerFacebookUrl: (lead.contacts || []).find((contact) => (
        contact.type === 'facebook' && contact.sourceType === 'google_owner_search'
      ))?.value || null,
      discoverySources: lead.discoverySources || [],
      source: lead.source,
      country: lead.country,
      language: lead.language,
      category: lead.category,
      shopifyConfidence: lead.shopifyConfidence,
      adActivityScore: lead.adActivityScore,
      trafficScore: lead.trafficScore,
      contactScore: lead.contactScore,
      totalScore: lead.totalScore,
      status: lead.status,
      discoveryStatus: discoveryCount > 1 ? 'seen_before' : 'first_seen',
      discoveryCount,
      workflowDiscoveries,
      recommendedAngle: lead.recommendedAngle,
      contacts: this.mapLeadContacts(lead.contacts || []),
      adEvidence: this.mapLeadAdEvidence(scoreReasons),
      createdAt: lead.createdAt.toISOString(),
    }
  }

  private mapLeadContacts(contacts: LeadContactEntity[]) {
    const mapped = new Map<string, ReturnType<AutoflowService['mapLeadContact']>>()
    for (const contact of contacts) {
      if (contact.type === 'website') continue
      const value = this.normalizeContactValue(contact.type, contact.value)
      const key = `${contact.type}|${value.toLowerCase()}`
      const candidate = this.mapLeadContact(contact, value)
      const previous = mapped.get(key)
      if (!previous || candidate.confidence > previous.confidence) mapped.set(key, candidate)
    }
    return [...mapped.values()].sort((left, right) => {
      const priority = { phone: 0, whatsapp: 1, facebook: 2, email: 3, instagram: 4, linkedin: 5 }
      return (priority[left.type as keyof typeof priority] ?? 9)
        - (priority[right.type as keyof typeof priority] ?? 9)
        || right.confidence - left.confidence
    })
  }

  private mapLeadAdEvidence(reasons: Record<string, unknown> | null) {
    const evidence = Array.isArray(reasons?.adEvidence) ? reasons.adEvidence : []
    const mapped = new Map<string, {
      provider: string
      evidenceSource: string
      platform: 'facebook' | 'instagram' | 'tiktok' | 'unknown'
      adId: string | null
      sourceUrl: string
      isDirectAdLink: boolean
      confidence: number
      matchReasons: string[]
    }>()
    for (const item of evidence) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const sourceUrl = typeof record.sourceUrl === 'string' ? record.sourceUrl : ''
      if (!this.isExternalHttpUrl(sourceUrl)) continue
      const confidence = typeof record.confidence === 'number' ? record.confidence : 0
      if (confidence <= 0) continue
      const provider = typeof record.provider === 'string' ? record.provider : 'unknown'
      const platform: 'facebook' | 'instagram' | 'tiktok' | 'unknown' = ['facebook', 'instagram', 'tiktok'].includes(String(record.platform))
        ? record.platform as 'facebook' | 'instagram' | 'tiktok'
        : this.adPlatformFromUrl(sourceUrl)
      const candidate = {
        provider,
        evidenceSource: typeof record.evidenceSource === 'string'
          ? record.evidenceSource
          : provider === 'pipiads' ? 'pipiads_api' : provider,
        platform,
        adId: typeof record.adId === 'string' ? record.adId : this.adIdFromUrl(sourceUrl),
        sourceUrl,
        isDirectAdLink: record.isDirectAdLink === true || /\/ads\/library/i.test(sourceUrl),
        confidence,
        matchReasons: Array.isArray(record.matchReasons)
          ? record.matchReasons.filter((value): value is string => typeof value === 'string')
          : [],
      }
      const key = `${candidate.provider}|${candidate.adId || candidate.sourceUrl}`
      const previous = mapped.get(key)
      if (!previous || candidate.confidence > previous.confidence) mapped.set(key, candidate)
    }
    return [...mapped.values()].sort((left, right) => (
      Number(right.platform === 'facebook') - Number(left.platform === 'facebook')
      || right.confidence - left.confidence
    ))
  }

  private isExternalHttpUrl(value: string): boolean {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }

  private adPlatformFromUrl(value: string): 'facebook' | 'instagram' | 'tiktok' | 'unknown' {
    try {
      const host = new URL(value).hostname.toLowerCase()
      if (/(^|\.)facebook\.com$/.test(host)) return 'facebook'
      if (/(^|\.)instagram\.com$/.test(host)) return 'instagram'
      if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok'
    } catch {
      return 'unknown'
    }
    return 'unknown'
  }

  private adIdFromUrl(value: string): string | null {
    try {
      return new URL(value).searchParams.get('id')
    } catch {
      return null
    }
  }

  private mapLeadContact(contact: LeadContactEntity, value: string) {
    const evidence = contact.evidence || {}
    return {
      type: contact.type,
      value,
      label: contact.label,
      verified: contact.verified,
      sourceUrl: contact.sourceUrl,
      sourceType: contact.sourceType,
      verificationStatus: contact.verificationStatus,
      confidence: contact.confidence,
      evidence,
      sourcePageTitle: typeof evidence.sourcePageTitle === 'string' ? evidence.sourcePageTitle : null,
      sourcePageKind: typeof evidence.sourcePageKind === 'string' ? evidence.sourcePageKind : null,
      extractedFrom: typeof evidence.extractedFrom === 'string' ? evidence.extractedFrom : contact.sourceType,
    }
  }

  private normalizeContactValue(type: LeadContactEntity['type'], value: string): string {
    if (!['facebook', 'instagram', 'linkedin', 'whatsapp'].includes(type)) return value.trim()
    try {
      const url = new URL(value)
      url.hash = ''
      if (type !== 'whatsapp') url.search = ''
      url.pathname = url.pathname.replace(/\/+$/, '') || '/'
      return url.toString()
    } catch {
      return value.trim()
    }
  }

  private mapOutreachTask(task: OutreachTaskEntity): OutreachTask {
    const lead = task.lead
    const contactPriority: Record<string, number> = {
      facebook: 0,
      whatsapp: 1,
      phone: 2,
      email: 3,
      instagram: 4,
      linkedin: 5,
      other: 6,
      website: 7,
    }
    const contactChannels = [...(lead?.contacts || [])]
      .filter((contact) => contact.type !== 'website')
      .sort((left, right) => (
        (contactPriority[left.type] ?? 99) - (contactPriority[right.type] ?? 99)
        || Number(right.verified) - Number(left.verified)
        || right.confidence - left.confidence
      ))
      .map((contact) => ({
        type: contact.type,
        value: contact.value,
        label: contact.label,
        verified: contact.verified,
        confidence: contact.confidence,
      }))

    return {
      id: task.id,
      leadId: task.leadId,
      leadName: lead?.brandName || 'Unknown lead',
      customer: {
        id: task.leadId,
        name: lead?.brandName || 'Unknown lead',
        domain: lead?.domain || '',
        storeUrl: lead?.storeUrl || '',
        country: lead?.country || '',
        category: lead?.category || '',
        totalScore: lead?.totalScore || 0,
        status: lead?.status || 'new',
      },
      contactChannels,
      channel: task.channel,
      status: task.status,
      message: task.message,
      targetContact: task.targetContact,
      subject: task.subject,
      templateKey: task.templateKey,
      templateOptions: task.templateOptions || {
        quoteMode: 'none',
        includeProductVisual: false,
        emphasizeSupplier: false,
        emphasizeLogistics: false,
        productImageUrl: null,
        verifiedQuoteContext: null,
      },
      sendUrl: this.buildSendUrl(task),
      recommendedNextAction: this.recommendedNextAction(task),
      nextFollowUpAt: task.nextFollowUpAt?.toISOString() || null,
      owner: task.owner?.username || 'Unassigned',
      createdAt: task.createdAt.toISOString(),
    }
  }

  private selectContact(
    contacts: LeadContactEntity[],
    channel: OutreachChannel,
  ): string | null {
    const preferredTypes = channel === 'email'
      ? ['email']
      : channel === 'whatsapp' ? ['whatsapp', 'phone'] : [channel]
    return [...contacts]
      .filter((contact) => preferredTypes.includes(contact.type))
      .sort((a, b) => Number(b.verified) - Number(a.verified) || b.confidence - a.confidence)[0]?.value || null
  }

  private messageTemplateKey(channel: OutreachChannel, options: OutreachTemplateOptions): string {
    const modules = [
      options.quoteMode,
      options.includeProductVisual ? 'visual' : null,
      options.emphasizeSupplier ? 'supplier' : null,
      options.emphasizeLogistics ? 'logistics' : null,
    ].filter(Boolean)
    return `${channel}-first-touch-v2-${modules.join('-')}`.slice(0, 80)
  }

  private buildSendUrl(task: OutreachTaskEntity): string | null {
    if (!task.targetContact) return null
    if (task.channel === 'email') {
      return `mailto:${encodeURIComponent(task.targetContact)}?subject=${encodeURIComponent(task.subject || '')}&body=${encodeURIComponent(task.message)}`
    }
    if (task.channel === 'whatsapp') {
      const digits = task.targetContact.replace(/.*wa\.me\//i, '').split(/[?/#]/)[0].replace(/\D/g, '')
      return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(task.message)}` : null
    }
    return /^https:\/\//i.test(task.targetContact) ? task.targetContact : null
  }

  private recommendedNextAction(task: OutreachTaskEntity): string {
    if (task.status === 'draft') return 'Review and approve the message'
    if (task.status === 'ready') return task.targetContact
      ? `Open ${task.channel} and send manually`
      : `Add a verified ${task.channel} contact before sending`
    if (task.status === 'sent') return task.nextFollowUpAt
      ? `Follow up on ${task.nextFollowUpAt.toISOString()}`
      : 'Schedule a follow-up'
    if (task.status === 'replied') return 'Qualify the reply and prepare a quote'
    if (task.status === 'failed') return 'Review the contact and retry'
    return 'No action required'
  }
}
