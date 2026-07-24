import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm'
import { WorkflowRunEntity } from '../../autoflow/entities/workflow-run.entity'
import { User } from '../../users/user.entity'
import {
  SOURCING_PROVIDER,
  type SourcingProvider,
  type SourcingSearchMode,
  type SourcingSearchStatus,
} from '../sourcing.types'
import { SourcingOfferEntity } from './sourcing-offer.entity'
import { SourcingSupplierEntity } from './sourcing-supplier.entity'

@Entity('sourcing_searches')
@Unique('uq_sourcing_searches_owner_request', ['ownerUserId', 'requestId'])
@Index('idx_sourcing_searches_owner_created', ['ownerUserId', 'createdAt'])
@Index('idx_sourcing_searches_workflow_status', ['workflowRunId', 'status'])
@Index('idx_sourcing_searches_provider_request', ['provider', 'providerRequestId'])
@Check('chk_sourcing_searches_provider', "provider = 'alibaba_1688'")
@Check('chk_sourcing_searches_mode', "search_mode IN ('keyword', 'image')")
@Check(
  'chk_sourcing_searches_status',
  "status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')",
)
export class SourcingSearchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ type: 'varchar', length: 32, default: SOURCING_PROVIDER })
  provider: SourcingProvider

  @Column({ name: 'search_mode', type: 'varchar', length: 16 })
  searchMode: SourcingSearchMode

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: SourcingSearchStatus

  @Column({ name: 'request_id', type: 'varchar', length: 128 })
  requestId: string

  @Column({ name: 'provider_request_id', type: 'varchar', length: 128, nullable: true })
  providerRequestId: string | null

  @Column({ name: 'provider_method', type: 'varchar', length: 160 })
  providerMethod: string

  @Column({ type: 'text', nullable: true })
  keyword: string | null

  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null

  @Column({ name: 'request_payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  requestPayload: Record<string, unknown>

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode: string | null

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_sourcing_searches_owner' })
  owner: User

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workflow_run_id',
    foreignKeyConstraintName: 'fk_sourcing_searches_workflow',
  })
  workflowRun: WorkflowRunEntity

  @OneToMany(() => SourcingSupplierEntity, (supplier) => supplier.search)
  suppliers: SourcingSupplierEntity[]

  @OneToMany(() => SourcingOfferEntity, (offer) => offer.search)
  offers: SourcingOfferEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
