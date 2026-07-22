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
import { User } from '../../users/user.entity'
import { WorkflowRunEntity } from '../../autoflow/entities/workflow-run.entity'

@Entity('ad_creatives')
@Unique('uq_ad_creatives_run_provider_key', ['workflowRunId', 'provider', 'deduplicationKey'])
@Index('idx_ad_creatives_owner_discovered_at', ['ownerUserId', 'discoveredAt'])
@Index('idx_ad_creatives_team_id', ['teamId'])
@Index('idx_ad_creatives_workflow_run_id', ['workflowRunId'])
@Check('chk_ad_creatives_confidence', 'confidence >= 0 AND confidence <= 100')
export class AdCreativeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ length: 40 })
  provider: string

  @Column({ name: 'deduplication_key', length: 64 })
  deduplicationKey: string

  @Column({ name: 'advertiser_name', length: 160 })
  advertiserName: string

  @Column({ name: 'source_url', length: 1000 })
  sourceUrl: string

  @Column({ type: 'text', default: '' })
  description: string

  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null

  @Column({ type: 'double precision', default: 0 })
  confidence: number

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_ad_creatives_workflow_run' })
  workflowRun: WorkflowRunEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_ad_creatives_owner' })
  owner: User

  @CreateDateColumn({ name: 'discovered_at', type: 'timestamptz' })
  discoveredAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
