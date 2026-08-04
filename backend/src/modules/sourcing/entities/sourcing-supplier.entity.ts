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
  type SourcingSupplierCapabilities,
} from '../sourcing.types'
import { SourcingOfferEntity } from './sourcing-offer.entity'
import { SourcingSearchEntity } from './sourcing-search.entity'

@Entity('sourcing_suppliers')
@Unique('uq_sourcing_suppliers_search_provider_key', ['searchId', 'provider', 'supplierKey'])
@Index('idx_sourcing_suppliers_owner_rating', ['ownerUserId', 'supplierRating'])
@Index('idx_sourcing_suppliers_workflow', ['workflowRunId'])
@Index('idx_sourcing_suppliers_search', ['searchId'])
@Index('idx_sourcing_suppliers_member', ['provider', 'memberId'])
@Index('idx_sourcing_suppliers_open_id', ['provider', 'openId'])
@Check('chk_sourcing_suppliers_provider', "provider = 'alibaba_1688'")
@Check(
  'chk_sourcing_suppliers_rating',
  'supplier_rating IS NULL OR (supplier_rating >= 0 AND supplier_rating <= 100)',
)
@Check(
  'chk_sourcing_suppliers_years',
  'years_in_business IS NULL OR years_in_business >= 0',
)
export class SourcingSupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'search_id', type: 'uuid' })
  searchId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ type: 'varchar', length: 32, default: SOURCING_PROVIDER })
  provider: SourcingProvider

  @Column({ name: 'supplier_key', type: 'varchar', length: 255 })
  supplierKey: string

  @Column({ name: 'member_id', type: 'varchar', length: 128, nullable: true })
  memberId: string | null

  @Column({ name: 'open_id', type: 'varchar', length: 128, nullable: true })
  openId: string | null

  @Column({ name: 'company_name', type: 'varchar', length: 255, nullable: true })
  companyName: string | null

  @Column({ name: 'shop_name', type: 'varchar', length: 255, nullable: true })
  shopName: string | null

  @Column({ name: 'shop_url', type: 'varchar', length: 1000, nullable: true })
  shopUrl: string | null

  @Column({ name: 'supplier_rating', type: 'decimal', precision: 9, scale: 4, nullable: true })
  supplierRating: string | null

  @Column({ name: 'years_in_business', type: 'integer', nullable: true })
  yearsInBusiness: number | null

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  capabilities: SourcingSupplierCapabilities

  @ManyToOne(() => SourcingSearchEntity, (search) => search.suppliers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_id', foreignKeyConstraintName: 'fk_sourcing_suppliers_search' })
  search: SourcingSearchEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_sourcing_suppliers_owner' })
  owner: User

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workflow_run_id',
    foreignKeyConstraintName: 'fk_sourcing_suppliers_workflow',
  })
  workflowRun: WorkflowRunEntity

  @OneToMany(() => SourcingOfferEntity, (offer) => offer.supplier)
  offers: SourcingOfferEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
