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
import type { SourcingPageStatus } from '../sourcing.types'
import { SourcingSearchEntity } from './sourcing-search.entity'

@Entity('sourcing_search_pages')
@Unique('uq_sourcing_search_pages_search_page', ['searchId', 'pageNumber'])
@Index('idx_sourcing_search_pages_status_available', ['status', 'availableAt'])
@Index('idx_sourcing_search_pages_search_page', ['searchId', 'pageNumber'])
@Index('idx_sourcing_search_pages_owner_search', ['ownerUserId', 'searchId'])
@Index('idx_sourcing_search_pages_lease_expires', ['leaseExpiresAt'])
@Index(
  'idx_sourcing_pages_cache_lookup',
  ['pageNumber', 'pageSize', 'status', 'completedAt'],
)
@Check('chk_sourcing_search_pages_page_number', 'page_number >= 1')
@Check('chk_sourcing_search_pages_page_size', 'page_size IN (10, 20, 50)')
@Check(
  'chk_sourcing_search_pages_attempts',
  'attempts >= 0 AND attempts <= max_attempts AND max_attempts >= 1',
)
export class SourcingSearchPageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'search_id', type: 'uuid' })
  searchId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'page_number', type: 'integer' })
  pageNumber: number

  @Column({ name: 'page_size', type: 'integer' })
  pageSize: number

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: SourcingPageStatus

  @Column({ type: 'integer', default: 0 })
  attempts: number

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts: number

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date

  @Column({ name: 'lease_owner', type: 'varchar', length: 255, nullable: true })
  leaseOwner: string | null

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null

  @Column({ name: 'provider_request_id', type: 'varchar', length: 128, nullable: true })
  providerRequestId: string | null

  @Column({ name: 'provider_trace_id', type: 'varchar', length: 128, nullable: true })
  providerTraceId: string | null

  @Column({ name: 'result_count', type: 'integer', default: 0 })
  resultCount: number

  @Column({ name: 'cache_hit', type: 'boolean', default: false })
  cacheHit: boolean

  @Column({ name: 'cache_source_page_id', type: 'uuid', nullable: true })
  cacheSourcePageId: string | null

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode: string | null

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null

  @ManyToOne(() => SourcingSearchEntity, (search) => search.pages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_id', foreignKeyConstraintName: 'fk_sourcing_search_pages_search' })
  search: SourcingSearchEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_sourcing_search_pages_owner' })
  owner: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
