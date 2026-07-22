import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm'
import { User } from '../../users/user.entity'
import type { QuoteRequestSnapshot, QuoteResultSnapshot } from '../quotation.types'
import { QuotationEntity } from './quotation.entity'

export type QuoteProviderStatus = 'not_requested' | 'pending' | 'succeeded' | 'failed' | 'unavailable'

@Entity('quotation_versions')
@Unique('uq_quotation_versions_quote_version', ['quotationId', 'version'])
@Index('idx_quotation_versions_quote_created_at', ['quotationId', 'createdAt'])
export class QuotationVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'quotation_id', type: 'uuid' })
  quotationId: string

  @Column({ type: 'integer' })
  version: number

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string

  @Column({ name: 'request_snapshot', type: 'jsonb' })
  requestSnapshot: QuoteRequestSnapshot

  @Column({ name: 'result_snapshot', type: 'jsonb', nullable: true })
  resultSnapshot: QuoteResultSnapshot | null

  @Column({ name: 'product_cost_status', type: 'varchar', length: 24, default: 'not_requested' })
  productCostStatus: QuoteProviderStatus

  @Column({ name: 'logistics_rate_status', type: 'varchar', length: 24, default: 'not_requested' })
  logisticsRateStatus: QuoteProviderStatus

  @Column({ name: 'source_version', type: 'varchar', length: 120, nullable: true })
  sourceVersion: string | null

  @Column({ name: 'effective_at', type: 'timestamptz', nullable: true })
  effectiveAt: Date | null

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null

  @ManyToOne(() => QuotationEntity, (quotation) => quotation.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quotation_id', foreignKeyConstraintName: 'fk_quotation_versions_quote' })
  quotation: QuotationEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', foreignKeyConstraintName: 'fk_quotation_versions_creator' })
  createdBy: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
