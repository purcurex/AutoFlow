import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import {
  LeadEntity,
  LeadContactEntity,
  LeadScoreEntity,
  WorkflowJobEntity,
  WorkflowLeadEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from '../autoflow/entities'
import type { WorkflowStage } from '../autoflow/autoflow.types'
import { DiscoveryService } from './discovery.service'
import type { DiscoveryEvidenceResult, LeadCandidate } from './discovery.types'
import { ShopifyStoreEntity } from './entities'
import { calculateContactScore } from './contact-scoring'
import { SourcingService } from '../sourcing/sourcing.service'

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

  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(WorkflowStepEntity)
    private readonly workflowStepRepository: Repository<WorkflowStepEntity>,
    private readonly discoveryService: DiscoveryService,
    private readonly sourcingService: SourcingService,
    private readonly dataSource: DataSource,
  ) {}

  async startDiscovery(ownerUserId: string, workflowRunId: string): Promise<DiscoveryStartResult> {
    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const stepRepository = manager.getRepository(WorkflowStepEntity)
      const jobRepository = manager.getRepository(WorkflowJobEntity)
      const workflow = await workflowRepository.createQueryBuilder('workflow')
        .setLock('pessimistic_write')
        .where('workflow.id = :workflowRunId', { workflowRunId })
        .andWhere('workflow.ownerUserId = :ownerUserId', { ownerUserId })
        .getOne()

      if (!workflow) throw new NotFoundException('Workflow not found')
      if (workflow.status === 'completed' || workflow.status === 'cancelled') {
        throw new ConflictException(`Workflow cannot start discovery from ${workflow.status}`)
      }

      const resumed = workflow.status === 'running' || workflow.status === 'failed'
      const existingJob = await jobRepository.findOne({ where: { workflowRunId } })
      if (existingJob?.status === 'queued' || existingJob?.status === 'running') {
        return { workflowRunId, status: 'running', scheduled: false, resumed: true }
      }

      await stepRepository.update(
        { workflowRunId, status: In(['running', 'failed']) },
        { status: 'pending', errorMessage: null, startedAt: null, completedAt: null },
      )
      await workflowRepository.update(
        { id: workflowRunId, ownerUserId },
        {
          status: 'running',
          currentStage: 'ad_discovery',
          progress: Math.max(workflow.progress, 10),
          startedAt: workflow.startedAt || new Date(),
          completedAt: null,
        },
      )

      const job = jobRepository.create({
        ...existingJob,
        workflowRunId,
        ownerUserId,
        status: 'queued',
        attempts: 0,
        maxAttempts: existingJob?.maxAttempts || 3,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        lastError: null,
        completedAt: null,
      })
      await jobRepository.save(job)

      return { workflowRunId, status: 'running', scheduled: true, resumed }
    })
  }

  async executeQueuedDiscovery(ownerUserId: string, workflowRunId: string): Promise<void> {
    let activeStages: WorkflowStage[] = ['ad_discovery', 'store_detection']

    try {
      const workflow = await this.requireWorkflow(ownerUserId, workflowRunId)
      await this.workflowStepRepository.update(
        { workflowRunId, status: In(['running', 'failed']) },
        { status: 'pending', errorMessage: null, startedAt: null, completedAt: null },
      )
      await this.workflowRepository.update(
        { id: workflowRunId, ownerUserId },
        { status: 'running', completedAt: null },
      )
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
      await this.sourcingService.runForWorkflow(ownerUserId, workflowRunId)
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
      throw error
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
      const contactRepository = manager.getRepository(LeadContactEntity)
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
          productUrl: candidate.productUrl,
          discoverySources: candidate.discoverySources,
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
            ['brand_name', 'domain', 'store_url', 'product_url', 'source', 'discovery_sources', 'shopify_confidence', 'traffic_score'],
            ['owner_user_id', 'normalized_domain'],
            { skipUpdateIfNoValuesChanged: true },
          )
          .execute()

        const lead = await leadRepository.findOneOrFail({
          where: { ownerUserId: workflow.ownerUserId, normalizedDomain: candidate.normalizedDomain },
        })
        await linkRepository
          .createQueryBuilder()
          .insert()
          .into(WorkflowLeadEntity)
          .values({
            workflowRunId: workflow.id,
            leadId: lead.id,
            source: candidate.source,
            sourceReference: candidate.storeUrl,
            sourceScore: candidate.shopifyConfidence,
            metadata: {
              normalizedDomain: candidate.normalizedDomain,
              productUrl: candidate.productUrl,
              discoverySources: candidate.discoverySources,
              validityScore: candidate.validityScore,
            },
          } as QueryDeepPartialEntity<WorkflowLeadEntity>)
          .orUpdate(
            ['source', 'source_reference', 'source_score', 'metadata'],
            ['workflow_run_id', 'lead_id'],
            { skipUpdateIfNoValuesChanged: true },
          )
          .execute()
        await storeRepository.update(
          { workflowRunId: workflow.id, normalizedDomain: candidate.normalizedDomain },
          { leadId: lead.id },
        )
        if (candidate.contacts.length > 0) {
          const contactRows = candidate.contacts.map((contact, index) => contactRepository.create({
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
          await contactRepository.upsert(
            contactRows as unknown as QueryDeepPartialEntity<LeadContactEntity>[],
            {
              conflictPaths: ['leadId', 'type', 'value'],
              skipUpdateIfNoValuesChanged: true,
            },
          )
        }
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

        lead.shopifyConfidence = dimensions.shopifyConfidence
        lead.adActivityScore = dimensions.adActivityScore
        lead.trafficScore = dimensions.trafficScore
        lead.contactScore = dimensions.contactScore
        lead.totalScore = dimensions.totalScore
        await leadRepository.save(lead)
        await linkRepository.update(
          { workflowRunId: workflow.id, leadId: lead.id },
          {
            sourceScore: dimensions.totalScore,
            metadata: dimensions.reasons,
          } as unknown as QueryDeepPartialEntity<WorkflowLeadEntity>,
        )
      }
    })
  }

  private calculateScore(
    workflow: WorkflowRunEntity,
    evidence: DiscoveryEvidenceResult,
    candidate: LeadCandidate,
  ) {
    const seedTokens = this.scoreTokens(workflow.seedValue)
    const candidateTokens = new Set(this.scoreTokens(
      `${candidate.brandName} ${candidate.domain} ${candidate.description}`,
    ))
    const matchedSeedTokens = seedTokens.filter((token) => candidateTokens.has(token)).length
    const categoryFitScore = workflow.seedType === 'keyword'
      ? Math.min(100, 45 + matchedSeedTokens * 20)
      : 55
    const adActivityScore = candidate.adEvidence.length === 0
      ? 0
      : Math.min(100, Math.round(
          candidate.adEvidence.reduce((sum, item) => sum + item.confidence, 0) / candidate.adEvidence.length
          + Math.min(15, (candidate.adEvidence.length - 1) * 5),
        ))
    const contactScoreResult = calculateContactScore(candidate.contacts)
    const contactScore = contactScoreResult.score
    const dropshippingFitScore = Math.round(
      candidate.shopifyConfidence * 0.5 + candidate.trafficScore * 0.25 + adActivityScore * 0.25,
    )
    const riskScore = ({
      verified: 10,
      probable: 20,
      mock: 25,
      unverified: 55,
      failed: 75,
    } as const)[candidate.verificationStatus]
    const totalScore = Math.max(0, Math.min(100, Math.round(
      candidate.shopifyConfidence * 0.2
      + adActivityScore * 0.15
      + candidate.trafficScore * 0.1
      + contactScore * 0.25
      + categoryFitScore * 0.1
      + dropshippingFitScore * 0.1
      + candidate.validityScore * 0.1
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
      modelVersion: 'rules-v3-priority-contact-ads',
      reasons: {
        adEvidenceCount: evidence.ads.length,
        linkedAdEvidenceCount: candidate.adEvidence.length,
        adEvidence: candidate.adEvidence,
        contactEvidenceCount: candidate.contacts.length,
        contactTypes: [...new Set(candidate.contacts.map((contact) => contact.type))],
        priorityContactTypes: contactScoreResult.priorityTypes,
        priorityContactCount: contactScoreResult.priorityCount,
        hasOwnerFacebookProfile: contactScoreResult.hasOwnerFacebookProfile,
        emailOnlyCapApplied: contactScoreResult.emailOnlyCapApplied,
        storeVerificationStatus: candidate.verificationStatus,
        productUrl: candidate.productUrl,
        discoverySources: candidate.discoverySources,
        validityScore: candidate.validityScore,
        matchedSeedTokens,
      },
    }
  }

  private scoreTokens(value: string): string[] {
    return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
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
