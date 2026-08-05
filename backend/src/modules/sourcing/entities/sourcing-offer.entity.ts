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
import { WorkflowRunEntity } from '../../autoflow/entities/workflow-run.entity'
import { User } from '../../users/user.entity'
import {
  SOURCING_PROVIDER,
  type SourcingPriceTier,
  type SourcingProvider,
  type SourcingRawSnapshot,
  type SourcingScoreReason,
} from '../sourcing.types'
import { SourcingSearchEntity } from './sourcing-search.entity'
import { SourcingSupplierEntity } from './sourcing-supplier.entity'

@Entity('sourcing_offers')
@Unique('uq_sourcing_offers_search_provider_offer', ['searchId', 'provider', 'offerId'])
@Index('idx_sourcing_offers_owner_score', ['ownerUserId', 'sourcingScore'])
@Index('idx_sourcing_offers_workflow', ['workflowRunId'])
@Index('idx_sourcing_offers_search', ['searchId'])
@Index('idx_sourcing_offers_supplier', ['supplierId'])
@Index('idx_sourcing_offers_provider_offer', ['provider', 'offerId'])
@Index(
  'idx_sourcing_offers_owner_provider_offer_recent',
  ['ownerUserId', 'provider', 'offerId', 'retrievedAt'],
)
@Index(
  'uq_sourcing_offers_search_provider_fingerprint',
  ['searchId', 'provider', 'productFingerprint'],
  { unique: true, where: '"product_fingerprint" IS NOT NULL' },
)
@Check('chk_sourcing_offers_provider', "provider = 'alibaba_1688'")
@Check('chk_sourcing_offers_score', 'sourcing_score >= 0 AND sourcing_score <= 100')
@Check(
  'chk_sourcing_offers_repurchase_rate',
  'repurchase_rate IS NULL OR (repurchase_rate >= 0 AND repurchase_rate <= 100)',
)
@Check(
  'chk_sourcing_offers_moq',
  'minimum_order_quantity IS NULL OR minimum_order_quantity >= 0',
)
@Check(
  'chk_sourcing_offers_prices',
  '(price_min IS NULL OR price_min >= 0) AND (price_max IS NULL OR price_max >= 0) AND (price_min IS NULL OR price_max IS NULL OR price_max >= price_min)',
)
export class SourcingOfferEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'search_id', type: 'uuid' })
  searchId: string

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ type: 'varchar', length: 32, default: SOURCING_PROVIDER })
  provider: SourcingProvider

  @Column({ name: 'offer_id', type: 'varchar', length: 128 })
  offerId: string

  @Column({ name: 'product_fingerprint', type: 'varchar', length: 64, nullable: true })
  productFingerprint: string | null

  @Column({ name: 'offer_url', type: 'varchar', length: 1000 })
  offerUrl: string

  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null

  @Column({ type: 'varchar', length: 500 })
  title: string

  @Column({ name: 'title_zh', type: 'varchar', length: 500, nullable: true })
  titleZh: string | null

  @Column({ name: 'title_en', type: 'varchar', length: 500, nullable: true })
  titleEn: string | null

  @Column({ name: 'category_id', type: 'varchar', length: 128, nullable: true })
  categoryId: string | null

  @Column({ name: 'category_name', type: 'varchar', length: 255, nullable: true })
  categoryName: string | null

  @Column({
    name: 'minimum_order_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  minimumOrderQuantity: string | null

  @Column({ name: 'quantity_unit', type: 'varchar', length: 32, nullable: true })
  quantityUnit: string | null

  @Column({ name: 'price_min', type: 'decimal', precision: 18, scale: 4, nullable: true })
  priceMin: string | null

  @Column({ name: 'price_max', type: 'decimal', precision: 18, scale: 4, nullable: true })
  priceMax: string | null

  @Column({ type: 'varchar', length: 8, default: 'CNY' })
  currency: string

  @Column({ name: 'price_tiers', type: 'jsonb', default: () => "'[]'::jsonb" })
  priceTiers: SourcingPriceTier[]

  @Column({ name: 'sales_volume', type: 'bigint', nullable: true })
  salesVolume: string | null

  @Column({ name: 'repurchase_rate', type: 'decimal', precision: 9, scale: 4, nullable: true })
  repurchaseRate: string | null

  @Column({ name: 'page_number', type: 'integer', default: 1 })
  pageNumber: number

  @Column({ name: 'rank_in_page', type: 'integer', default: 1 })
  rankInPage: number

  @Column({ name: 'absolute_rank', type: 'integer', default: 1 })
  absoluteRank: number

  @Column({ name: 'detail_status', type: 'varchar', length: 24, default: 'not_requested' })
  detailStatus: 'not_requested' | 'succeeded' | 'failed'

  @Column({ name: 'detail_retrieved_at', type: 'timestamptz', nullable: true })
  detailRetrievedAt: Date | null

  @Column({ name: 'score_version', type: 'varchar', length: 32, default: 'v1' })
  scoreVersion: string

  @Column({ name: 'score_dimensions', type: 'jsonb', default: () => "'{}'::jsonb" })
  scoreDimensions: Record<string, unknown>

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags: string[]

  @Column({ name: 'sourcing_score', type: 'double precision', default: 0 })
  sourcingScore: number

  @Column({ name: 'sourcing_score_reasons', type: 'jsonb', default: () => "'[]'::jsonb" })
  sourcingScoreReasons: SourcingScoreReason[]

  @Column({ name: 'raw_snapshot', type: 'jsonb', default: () => "'{}'::jsonb" })
  rawSnapshot: SourcingRawSnapshot

  @ManyToOne(() => SourcingSearchEntity, (search) => search.offers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_id', foreignKeyConstraintName: 'fk_sourcing_offers_search' })
  search: SourcingSearchEntity

  @ManyToOne(() => SourcingSupplierEntity, (supplier) => supplier.offers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'fk_sourcing_offers_supplier' })
  supplier: SourcingSupplierEntity | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_sourcing_offers_owner' })
  owner: User

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workflow_run_id',
    foreignKeyConstraintName: 'fk_sourcing_offers_workflow',
  })
  workflowRun: WorkflowRunEntity

  @CreateDateColumn({ name: 'retrieved_at', type: 'timestamptz' })
  retrievedAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
