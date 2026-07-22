import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { LeadEntity } from '../../autoflow/entities'
import { User } from '../../users/user.entity'
import { QuotationVersionEntity } from './quotation-version.entity'

export type QuotationStatus = 'draft' | 'ready' | 'expired' | 'cancelled'

@Entity('quotations')
@Index('idx_quotations_owner_updated_at', ['ownerUserId', 'updatedAt'])
@Index('idx_quotations_lead_id', ['leadId'])
@Index('idx_quotations_status', ['status'])
export class QuotationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null

  @Column({ type: 'varchar', length: 160, default: 'Customer quotation' })
  title: string

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: QuotationStatus

  @Column({ type: 'char', length: 3 })
  currency: string

  @Column({ name: 'current_version', type: 'integer', default: 1 })
  currentVersion: number

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_quotations_owner' })
  owner: User

  @ManyToOne(() => LeadEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_quotations_lead' })
  lead: LeadEntity | null

  @OneToMany(() => QuotationVersionEntity, (version) => version.quotation)
  versions: QuotationVersionEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
