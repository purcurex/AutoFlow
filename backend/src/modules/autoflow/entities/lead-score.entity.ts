import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { User } from '../../users/user.entity'
import { LeadEntity } from './lead.entity'
import { WorkflowRunEntity } from './workflow-run.entity'

@Entity('lead_scores')
@Index('idx_lead_scores_lead_calculated_at', ['leadId', 'calculatedAt'])
@Index('idx_lead_scores_owner_total_score', ['ownerUserId', 'totalScore'])
@Index('idx_lead_scores_team_id', ['teamId'])
@Index('idx_lead_scores_workflow_run_id', ['workflowRunId'])
@Index('uq_lead_scores_lead_workflow', ['leadId', 'workflowRunId'], {
  unique: true,
})
@Check(
  'chk_lead_scores_dimensions',
  'shopify_confidence BETWEEN 0 AND 100 AND ad_activity_score BETWEEN 0 AND 100 AND traffic_score BETWEEN 0 AND 100 AND contact_score BETWEEN 0 AND 100 AND category_fit_score BETWEEN 0 AND 100 AND dropshipping_fit_score BETWEEN 0 AND 100 AND risk_score BETWEEN 0 AND 100 AND total_score BETWEEN 0 AND 100',
)
export class LeadScoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ name: 'workflow_run_id', type: 'uuid', nullable: true })
  workflowRunId: string | null

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ name: 'shopify_confidence', type: 'double precision', default: 0 })
  shopifyConfidence: number

  @Column({ name: 'ad_activity_score', type: 'double precision', default: 0 })
  adActivityScore: number

  @Column({ name: 'traffic_score', type: 'double precision', default: 0 })
  trafficScore: number

  @Column({ name: 'contact_score', type: 'double precision', default: 0 })
  contactScore: number

  @Column({ name: 'category_fit_score', type: 'double precision', default: 0 })
  categoryFitScore: number

  @Column({ name: 'dropshipping_fit_score', type: 'double precision', default: 0 })
  dropshippingFitScore: number

  @Column({ name: 'risk_score', type: 'double precision', default: 0 })
  riskScore: number

  @Column({ name: 'total_score', type: 'double precision', default: 0 })
  totalScore: number

  @Column({ length: 16, default: 'unrated' })
  grade: string

  @Column({ name: 'model_version', length: 40, default: 'rules-v1' })
  modelVersion: string

  @Column({ type: 'jsonb', nullable: true })
  reasons: Record<string, unknown> | null

  @ManyToOne(() => LeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_lead_scores_lead' })
  lead: LeadEntity

  @ManyToOne(() => WorkflowRunEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_lead_scores_workflow_run' })
  workflowRun: WorkflowRunEntity | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_lead_scores_owner' })
  owner: User

  @CreateDateColumn({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date
}
