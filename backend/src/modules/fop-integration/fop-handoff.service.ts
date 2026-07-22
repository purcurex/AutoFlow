import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { CrmActivityEntity, LeadEntity } from '../autoflow/entities'
import { FopCrmHandoffPort } from './fop-integration.types'
import { FopHandoffEntity } from './fop-handoff.entity'

@Injectable()
export class FopHandoffService {
  constructor(
    @InjectRepository(FopHandoffEntity)
    private readonly handoffRepository: Repository<FopHandoffEntity>,
    @InjectRepository(CrmActivityEntity)
    private readonly activityRepository: Repository<CrmActivityEntity>,
    private readonly handoffPort: FopCrmHandoffPort,
    private readonly dataSource: DataSource,
  ) {}

  async handoff(ownerUserId: string, leadId: string, reason: string): Promise<FopHandoffEntity> {
    const claim = await this.dataSource.transaction(async (manager) => {
      const lead = await manager.getRepository(LeadEntity).createQueryBuilder('lead')
        .setLock('pessimistic_write')
        .where('lead.id = :leadId', { leadId })
        .andWhere('lead.ownerUserId = :ownerUserId', { ownerUserId })
        .getOne()
      if (!lead) throw new NotFoundException('Lead not found')

      const repository = manager.getRepository(FopHandoffEntity)
      const existing = await repository.findOne({ where: { leadId, ownerUserId } })
      const pendingIsFresh = existing?.status === 'pending'
        && Date.now() - existing.updatedAt.getTime() < 2 * 60 * 1000
      if (existing?.status === 'succeeded' || existing?.status === 'requires_review' || pendingIsFresh) {
        return { record: existing, shouldCall: false }
      }

      const record = repository.create({
        ...existing,
        leadId,
        ownerUserId,
        idempotencyKey: existing?.idempotencyKey || `fop-handoff:${leadId}`,
        status: 'pending',
        conflicts: existing?.conflicts || [],
        lastError: null,
        attempts: (existing?.attempts || 0) + 1,
      })
      return { record: await repository.save(record), shouldCall: true }
    })

    if (!claim.shouldCall) return claim.record

    try {
      const result = await this.handoffPort.handoffProspect({
        idempotencyKey: claim.record.idempotencyKey,
        correlationId: claim.record.id,
        autoFlowLeadId: leadId,
        handoffReason: reason.trim(),
      })
      claim.record.status = result.syncStatus
      claim.record.fopLeadId = result.fopLeadId
      claim.record.fopOpportunityId = result.fopOpportunityId || null
      claim.record.conflicts = result.conflicts
      claim.record.lastError = null
      claim.record.lastSyncedAt = new Date(result.updatedAt)
    } catch (error: unknown) {
      claim.record.status = this.isUnavailable(error) ? 'unavailable' : 'failed'
      claim.record.lastError = this.errorMessage(error).slice(0, 4000)
      claim.record.lastSyncedAt = new Date()
    }

    const saved = await this.handoffRepository.save(claim.record)
    await this.activityRepository.save(this.activityRepository.create({
      leadId,
      ownerUserId,
      teamId: null,
      type: 'handoff',
      subject: `FOP handoff ${saved.status}`,
      content: reason.trim(),
      fromStatus: null,
      toStatus: null,
      metadata: {
        handoffId: saved.id,
        fopLeadId: saved.fopLeadId,
        fopOpportunityId: saved.fopOpportunityId,
        conflicts: saved.conflicts,
      },
      occurredAt: new Date(),
      nextFollowUpAt: null,
    }))
    return saved
  }

  async getForLead(ownerUserId: string, leadId: string): Promise<FopHandoffEntity | null> {
    return this.handoffRepository.findOne({ where: { ownerUserId, leadId } })
  }

  private isUnavailable(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'status' in error && error.status === 503
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown FOP handoff error')
  }
}
