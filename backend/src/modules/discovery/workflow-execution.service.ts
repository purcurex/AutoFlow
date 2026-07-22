import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import {
  LeadEntity,
  LeadScoreEntity,
  WorkflowLeadEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from '../autoflow/entities'
import type { WorkflowStage } from '../autoflow/autoflow.types'
import { DiscoveryService } from './discovery.service'
import type { DiscoveryEvidenceResult, LeadCandidate } from './discovery.types'
import { ShopifyStoreEntity } from './entities'

export interface DiscoveryStartResult {
  workflowRunId: string
  status: 'running'
  scheduled: boolean
  resumed: boolean
}

interface PromotedLead {
  lead: LeadEntity
  candidate: LeadCandidate
}

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name)
  private readonly activeRuns = new Set<string>()

  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkflowStepEntity)
    private readonly workflowStepRepository: Repository<WorkflowStepEntity>,
    private readonly discoveryService: DiscoveryService,
    private readonly dataSource: DataSource,
  ) {}

  async startDiscovery(ownerUserId: string, workflowRunId: string): Promise<DiscoveryStartResult> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')
    if (workflow.status === 'completed' || workflow.status === 'cancelled') {
      throw new ConflictException(`Workflow cannot start discovery from ${workflow.status}`)
    }

    const resumed = workflow.status === 'running' || workflow.status === 'failed'
    if (this.activeRuns.has(workflowRunId)) {
      return { workflowRunId, status: 'running', scheduled: false, resumed: true }
    }

    await this.workflowStepRepository.update(
      { workflowRunId, status: In(['running', 'failed']) },
      { status: 'pending', errorMessage: null, startedAt: null, completedAt: null },
    )
    await this.workflowRepository.update(
      { id: workflowRunId, ownerUserId },
      {
        status: 'running',
        currentStage: 'ad_discovery',
        progress: Math.max(workflow.progress, 10),
        startedAt: workflow.startedAt || new Date(),
        completedAt: null,
      },
    )

    this.activeRuns.add(workflowRunId)
    void Promise.resolve()
      .then(() => this.execute(ownerUserId, workflowRunId))
      .catch((error: unknown) => {
        this.logger.error(`Workflow ${workflowRunId} background execution failed`, error)
      })
      .finally(() => this.activeRuns.delete(workflowRunId))

    return { workflowRunId, status: 'running', scheduled: true, resumed }
  }

  private async execute(ownerUserId: string, workflowRunId: string): Promise<void> {
    let activeStages: WorkflowStage[] = ['ad_discovery', 'store_detection']

    try {
      const workflow = await this.requireWorkflow(ownerUserId, workflowRunId)
      const steps = await this.workflowStepRepository.find({ where: { workflowRunId } })
      const completedStages = new Set(
        steps.filter((step) => step.status === 'completed').map((step) => step.stage),
      )

      let evidence: DiscoveryEvidenceResult
      if (completedStages.has('ad_discovery') && completedStages.has('store_detection')) {
        evidence = await this.discoveryService.getPersistedEvidence(ownerUserId, workflowRunId)
      } else {
        await this.markSteps(workflowRunId, activeStages, 'running')
        evidence = await this.discoveryService.discoverEvidence(ownerUserId, workflowRunId)
        await this.completeStep(workflowRunId, 'ad_discovery', { count: evidence.ads.length })
        await this.completeStep(workflowRunId, 'store_detection', { count: evidence.stores.length })
      }
      await this.updateWorkflow(ownerUserId, workflowRunId, 'lead_cleaning', 55)

      activeStages = ['lead_cleaning']
      await this.markSteps(workflowRunId, activeStages, 'running')
      const promoted = await this.promoteCandidates(workflow, evidence)
      await this.completeStep(workflowRunId, 'lead_cleaning', { leadCount: promoted.length })
      await this.updateWorkflow(ownerUserId, workflowRunId, 'lead_scoring', 75)

      activeStages = ['lead_scoring']
      await this.markSteps(workflowRunId, activeStages, 'running')
      await this.scoreLeads(workflow, evidence, promoted)
      await this.completeStep(workflowRunId, 'lead_scoring', { leadCount: promoted.length })

      await this.workflowStepRepository.update(
        {
          workflowRunId,
          stage: In(['message_generation', 'outreach', 'crm']),
          status: 'pending',
        },
        {
          status: 'skipped',
          output: { reason: 'Deferred to the next AutoFlow delivery phase' },
          completedAt: new Date(),
        },
      )
      await this.workflowRepository.update(
        { id: workflowRunId, ownerUserId },
        {
          status: 'completed',
          currentStage: 'lead_scoring',
          progress: 100,
          leadCount: promoted.length,
          completedAt: new Date(),
        },
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown discovery error'
      await this.workflowStepRepository.update(
        { workflowRunId, stage: In(activeStages) },
        { status: 'failed', errorMessage: message.slice(0, 2000), completedAt: new Date() },
      )
      await this.workflowRepository.update(
        { id: workflowRunId, ownerUserId },
        { status: 'failed', currentStage: activeStages[0], completedAt: new Date() },
      )
      this.logger.error(`Workflow ${workflowRunId} failed at ${activeStages.join(', ')}`, error)
    }
  }

  private async promoteCandidates(
    workflow: WorkflowRunEntity,
    evidence: DiscoveryEvidenceResult,
  ): Promise<PromotedLead[]> {
    return this.dataSource.transaction(async (manager) => {
      const leadRepository = manager.getRepository(LeadEntity)
      const linkRepository = manager.getRepository(WorkflowLeadEntity)
      const storeRepository = manager.getRepository(ShopifyStoreEntity)
      const promoted: PromotedLead[] = []

      for (const candidate of evidence.candidates) {
        const values = leadRepository.create({
          workflowRunId: workflow.id,
          ownerUserId: workflow.ownerUserId,
          teamId: workflow.teamId,
          brandName: candidate.brandName,
          domain: candidate.domain,
          normalizedDomain: candidate.normalizedDomain,
          storeUrl: candidate.storeUrl,
          source: candidate.source,
          country: '',
          language: 'English',
          category: workflow.seedType === 'keyword' ? workflow.seedValue.slice(0, 120) : '',
          shopifyConfidence: candidate.shopifyConfidence,
          adActivityScore: 0,
          trafficScore: candidate.trafficScore,
          contactScore: 0,
          totalScore: 0,
          status: 'new',
          recommendedAngle: '',
        })
        await leadRepository
          .createQueryBuilder()
          .insert()
          .into(LeadEntity)
          .values(values as unknown as QueryDeepPartialEntity<LeadEntity>)
          .orUpdate(
            ['brand_name', 'domain', 'store_url', 'source', 'shopify_confidence', 'traffic_score'],
            ['owner_user_id', 'normalized_domain'],
            { skipUpdateIfNoValuesChanged: true },
          )
          .execute()

        const lead = await leadRepository.findOneOrFail({
          where: { ownerUserId: workflow.ownerUserId, normalizedDomain: candidate.normalizedDomain },
        })
        const existingLink = await linkRepository.findOne({
          where: { workflowRunId: workflow.id, leadId: lead.id },
        })
        await linkRepository.save(linkRepository.create({
          ...existingLink,
          workflowRunId: workflow.id,
          leadId: lead.id,
          source: candidate.source,
          sourceReference: candidate.storeUrl,
          sourceScore: candidate.shopifyConfidence,
          metadata: { normalizedDomain: candidate.normalizedDomain },
          discoveredAt: existingLink?.discoveredAt || new Date(),
        }))
        await storeRepository.update(
          { workflowRunId: workflow.id, normalizedDomain: candidate.normalizedDomain },
          { leadId: lead.id },
        )
        promoted.push({ lead, candidate })
      }

      return promoted
    })
  }

  private async scoreLeads(
    workflow: WorkflowRunEntity,
    evidence: DiscoveryEvidenceResult,
    promoted: PromotedLead[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const leadRepository = manager.getRepository(LeadEntity)
      const scoreRepository = manager.getRepository(LeadScoreEntity)
      const linkRepository = manager.getRepository(WorkflowLeadEntity)

      for (const { lead, candidate } of promoted) {
        const dimensions = this.calculateScore(workflow, evidence, candidate)
        const snapshot = scoreRepository.create({
          leadId: lead.id,
          workflowRunId: workflow.id,
          ownerUserId: workflow.ownerUserId,
          teamId: workflow.teamId,
          ...dimensions,
        })
        await scoreRepository.upsert(
          snapshot as unknown as QueryDeepPartialEntity<LeadScoreEntity>,
          { conflictPaths: ['leadId', 'workflowRunId'], skipUpdateIfNoValuesChanged: true },
        )

        lead.shopifyConfidence = Math.max(lead.shopifyConfidence, dimensions.shopifyConfidence)
        lead.adActivityScore = Math.max(lead.adActivityScore, dimensions.adActivityScore)
        lead.trafficScore = Math.max(lead.trafficScore, dimensions.trafficScore)
        lead.contactScore = Math.max(lead.contactScore, dimensions.contactScore)
        lead.totalScore = Math.max(lead.totalScore, dimensions.totalScore)
        await leadRepository.save(lead)
        await linkRepository.update(
          { workflowRunId: workflow.id, leadId: lead.id },
          { sourceScore: dimensions.totalScore, metadata: dimensions.reasons },
        )
      }
    })
  }

  private calculateScore(
    workflow: WorkflowRunEntity,
    evidence: DiscoveryEvidenceResult,
    candidate: LeadCandidate,
  ) {
    const categoryFitScore = workflow.seedType === 'keyword' ? 70 : 50
    const dropshippingFitScore = 60
    const riskScore = 20
    const adActivityScore = 0
    const contactScore = 0
    const totalScore = Math.max(0, Math.min(100, Math.round(
      candidate.shopifyConfidence * 0.25
      + adActivityScore * 0.15
      + candidate.trafficScore * 0.15
      + contactScore * 0.1
      + categoryFitScore * 0.15
      + dropshippingFitScore * 0.2
      - riskScore * 0.1,
    )))

    return {
      shopifyConfidence: candidate.shopifyConfidence,
      adActivityScore,
      trafficScore: candidate.trafficScore,
      contactScore,
      categoryFitScore,
      dropshippingFitScore,
      riskScore,
      totalScore,
      grade: totalScore >= 80 ? 'A' : totalScore >= 65 ? 'B' : totalScore >= 50 ? 'C' : 'D',
      modelVersion: 'rules-v1',
      reasons: {
        adEvidenceCount: evidence.ads.length,
        adEvidenceLinkedToStore: false,
        note: 'Seed-level ad evidence is retained but not attributed to a store without a verified match.',
      },
    }
  }

  private async requireWorkflow(ownerUserId: string, workflowRunId: string): Promise<WorkflowRunEntity> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')
    return workflow
  }

  private async markSteps(
    workflowRunId: string,
    stages: WorkflowStage[],
    status: 'running',
  ): Promise<void> {
    await this.workflowStepRepository.update(
      { workflowRunId, stage: In(stages) },
      { status, startedAt: new Date(), completedAt: null, errorMessage: null },
    )
  }

  private async completeStep(
    workflowRunId: string,
    stage: WorkflowStage,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.workflowStepRepository.update(
      { workflowRunId, stage },
      {
        status: 'completed',
        output,
        completedAt: new Date(),
        errorMessage: null,
      } as unknown as QueryDeepPartialEntity<WorkflowStepEntity>,
    )
  }

  private async updateWorkflow(
    ownerUserId: string,
    workflowRunId: string,
    currentStage: WorkflowStage,
    progress: number,
  ): Promise<void> {
    await this.workflowRepository.update(
      { id: workflowRunId, ownerUserId },
      { currentStage, progress },
    )
  }
}
