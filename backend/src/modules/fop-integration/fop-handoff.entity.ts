import {
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
import { LeadEntity } from '../autoflow/entities'
import { User } from '../users/user.entity'

export type FopHandoffStatus = 'pending' | 'succeeded' | 'requires_review' | 'failed' | 'unavailable'

@Entity('fop_handoffs')
@Unique('uq_fop_handoffs_lead', ['leadId'])
@Unique('uq_fop_handoffs_idempotency_key', ['idempotencyKey'])
@Index('idx_fop_handoffs_owner_updated_at', ['ownerUserId', 'updatedAt'])
@Index('idx_fop_handoffs_status', ['status'])
export class FopHandoffEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey: string

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: FopHandoffStatus

  @Column({ name: 'fop_lead_id', type: 'varchar', length: 160, nullable: true })
  fopLeadId: string | null

  @Column({ name: 'fop_opportunity_id', type: 'varchar', length: 160, nullable: true })
  fopOpportunityId: string | null

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  conflicts: string[]

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null

  @Column({ type: 'integer', default: 0 })
  attempts: number

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null

  @ManyToOne(() => LeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_fop_handoffs_lead' })
  lead: LeadEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_fop_handoffs_owner' })
  owner: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
