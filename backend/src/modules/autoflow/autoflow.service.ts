import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import {
  CreateWorkflowDto,
  GenerateMessageDto,
  ListLeadsQueryDto,
  ListOutreachTasksQueryDto,
  ListWorkflowsQueryDto,
  UpdateLeadStatusDto,
  UpdateOutreachTaskDto,
} from './dto/autoflow.dto'
import {
  AutoFlowDashboard,
  FollowUpStage,
  LEAD_STATUS_TRANSITIONS,
  LeadStatus,
  OUTREACH_STATUS_TRANSITIONS,
  OutreachTask,
  PaginatedResult,
  StoreLead,
  WORKFLOW_STAGES,
  WorkflowRun,
} from './autoflow.types'
import {
  CrmActivityEntity,
  LeadEntity,
  OutreachTaskEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from './entities'
import { AiService } from '../ai/ai.service'

@Injectable()
export class AutoflowService {
  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkflowStepEntity)
    private readonly workflowStepRepository: Repository<WorkflowStepEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(OutreachTaskEntity)
    private readonly outreachRepository: Repository<OutreachTaskEntity>,
    @InjectRepository(CrmActivityEntity)
    private readonly activityRepository: Repository<CrmActivityEntity>,
    private readonly dataSource: DataSource,
    private readonly aiService: AiService,
  ) {}

  async getDashboard(ownerUserId: string): Promise<AutoFlowDashboard> {
    const [activeWorkflows, newLeads, readyOutreach, replies, opportunities, workflows, leads, tasks, funnel] =
      await Promise.all([
        this.workflowRepository.count({ where: { ownerUserId, status: 'running' } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'new' } }),
        this.outreachRepository.count({ where: { ownerUserId, status: 'ready' } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'replied' } }),
        this.leadRepository.count({ where: { ownerUserId, status: 'opportunity' } }),
        this.workflowRepository.find({ where: { ownerUserId }, order: { createdAt: 'DESC' }, take: 5 }),
        this.leadRepository.find({
          where: { ownerUserId },
          relations: { contacts: true },
          order: { totalScore: 'DESC' },
          take: 5,
        }),
        this.outreachRepository.find({
          where: { ownerUserId, status: 'ready' },
          relations: { lead: true, owner: true },
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
      where: { ownerUserId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return { items: items.map((workflow) => this.mapWorkflow(workflow)), total, page, pageSize }
  }

  async createWorkflow(ownerUserId: string, data: CreateWorkflowDto): Promise<WorkflowRun> {
    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const stepRepository = manager.getRepository(WorkflowStepEntity)
      const workflow = await workflowRepository.save(
        workflowRepository.create({
          ownerUserId,
          teamId: null,
          name: data.name?.trim() || `${data.seedValue} prospect workflow`,
          seedType: data.seedType,
          seedValue: data.seedValue.trim(),
          targetMarket: data.targetMarket?.trim() || 'United States',
          status: 'draft',
          currentStage: 'seed',
          progress: 0,
          leadCount: 0,
          startedAt: null,
          completedAt: null,
        }),
      )

      await stepRepository.save(
        WORKFLOW_STAGES.map((stage, sequence) =>
          stepRepository.create({
            workflowRunId: workflow.id,
            stage,
            sequence,
            status: stage === 'seed' ? 'completed' : 'pending',
            input: stage === 'seed' ? { seedType: data.seedType, seedValue: data.seedValue } : null,
            output: null,
            errorMessage: null,
            startedAt: stage === 'seed' ? workflow.createdAt : null,
            completedAt: stage === 'seed' ? workflow.createdAt : null,
          }),
        ),
      )

      return this.mapWorkflow(workflow)
    })
  }

  async getLeads(ownerUserId: string, query: ListLeadsQueryDto): Promise<PaginatedResult<StoreLead>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const builder = this.leadRepository
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contacts', 'contact')
      .where('lead.owner_user_id = :ownerUserId', { ownerUserId })
      .orderBy('lead.total_score', 'DESC')
      .addOrderBy('lead.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    if (query.status) builder.andWhere('lead.status = :status', { status: query.status })
    if (query.workflowRunId) {
      builder
        .leftJoin('lead.workflowLinks', 'workflowLink')
        .andWhere('(lead.workflow_run_id = :workflowRunId OR workflowLink.workflow_run_id = :workflowRunId)', {
          workflowRunId: query.workflowRunId,
        })
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
      relations: { contacts: true },
    })
    if (!lead) throw new NotFoundException('Lead not found')
    return this.mapLead(lead)
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
    const lead = await this.leadRepository.findOne({ where: { id: leadId, ownerUserId } })
    if (!lead) throw new NotFoundException('Lead not found')

    const channel = data.channel || 'whatsapp'
    const message = await this.aiService.generateSalesOutreach({
      channel,
      language: data.language || lead.language || 'English',
      brandName: lead.brandName,
      domain: lead.domain,
      category: lead.category,
      country: lead.country,
      evidenceSummary: lead.recommendedAngle,
      offer: data.offer || 'low-MOQ sourcing, fast fulfillment, and product testing support',
    })

    const task = await this.outreachRepository.save(
      this.outreachRepository.create({
        leadId,
        ownerUserId,
        teamId: lead.teamId,
        channel,
        status: 'draft',
        message,
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
      .leftJoinAndSelect('task.owner', 'owner')
      .where('task.owner_user_id = :ownerUserId', { ownerUserId })
      .orderBy('task.next_follow_up_at', 'ASC', 'NULLS LAST')
      .addOrderBy('task.created_at', 'DESC')
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
      relations: { lead: true, owner: true },
    })
    if (!task) throw new NotFoundException('Outreach task not found')
    return this.mapOutreachTask(task)
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

  private mapWorkflow(workflow: WorkflowRunEntity): WorkflowRun {
    return {
      id: workflow.id,
      name: workflow.name,
      seedType: workflow.seedType,
      seedValue: workflow.seedValue,
      targetMarket: workflow.targetMarket,
      status: workflow.status,
      currentStage: workflow.currentStage,
      progress: workflow.progress,
      leadCount: workflow.leadCount,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    }
  }

  private mapLead(lead: LeadEntity): StoreLead {
    return {
      id: lead.id,
      workflowRunId: lead.workflowRunId,
      brandName: lead.brandName,
      domain: lead.domain,
      storeUrl: lead.storeUrl,
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
      recommendedAngle: lead.recommendedAngle,
      contacts: (lead.contacts || []).map((contact) => ({
        type: contact.type,
        value: contact.value,
        verified: contact.verified,
      })),
      createdAt: lead.createdAt.toISOString(),
    }
  }

  private mapOutreachTask(task: OutreachTaskEntity): OutreachTask {
    return {
      id: task.id,
      leadId: task.leadId,
      leadName: task.lead?.brandName || 'Unknown lead',
      channel: task.channel,
      status: task.status,
      message: task.message,
      nextFollowUpAt: task.nextFollowUpAt?.toISOString() || null,
      owner: task.owner?.username || 'Unassigned',
    }
  }
}
