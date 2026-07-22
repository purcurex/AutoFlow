import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm'
import { LeadEntity } from '../../autoflow/entities/lead.entity'
import { WorkflowRunEntity } from '../../autoflow/entities/workflow-run.entity'
import { User } from '../../users/user.entity'
import type { NormalizedContactEvidence, StoreVerificationStatus } from '../discovery.types'

@Entity('shopify_stores')
@Unique('uq_shopify_stores_run_domain', ['workflowRunId', 'normalizedDomain'])
@Index('idx_shopify_stores_owner_domain', ['ownerUserId', 'normalizedDomain'])
@Index('idx_shopify_stores_team_id', ['teamId'])
@Index('idx_shopify_stores_workflow_run_id', ['workflowRunId'])
@Index('idx_shopify_stores_lead_id', ['leadId'])
@Index('idx_shopify_stores_verification_status', ['verificationStatus'])
@Check('chk_shopify_stores_confidence', 'shopify_confidence >= 0 AND shopify_confidence <= 100')
export class ShopifyStoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null

  @Column({ length: 160 })
  name: string

  @Column({ length: 255 })
  domain: string

  @Column({ name: 'normalized_domain', length: 255 })
  normalizedDomain: string

  @Column({ length: 1000 })
  url: string

  @Column({ type: 'text', default: '' })
  description: string

  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null

  @Column({ name: 'detection_source', length: 80 })
  detectionSource: string

  @Column({ name: 'shopify_confidence', type: 'double precision', default: 0 })
  shopifyConfidence: number

  @Column({ name: 'verification_status', type: 'varchar', length: 24, default: 'unverified' })
  verificationStatus: StoreVerificationStatus

  @Column({ name: 'verification_evidence', type: 'jsonb', default: () => "'{}'::jsonb" })
  verificationEvidence: Record<string, unknown>

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  contacts: NormalizedContactEvidence[]

  @Column({ type: 'jsonb', nullable: true })
  traffic: Record<string, unknown> | null

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_shopify_stores_workflow_run' })
  workflowRun: WorkflowRunEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_shopify_stores_owner' })
  owner: User

  @ManyToOne(() => LeadEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_shopify_stores_lead' })
  lead: LeadEntity | null

  @CreateDateColumn({ name: 'discovered_at', type: 'timestamptz' })
  discoveredAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
