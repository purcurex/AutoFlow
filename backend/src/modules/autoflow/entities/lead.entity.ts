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
  UpdateDateColumn,
} from 'typeorm'
import { User } from '../../users/user.entity'
import { LEAD_STATUSES, type LeadStatus } from '../autoflow.types'
import { CrmActivityEntity } from './crm-activity.entity'
import { LeadContactEntity } from './lead-contact.entity'
import { OutreachTaskEntity } from './outreach-task.entity'
import { WorkflowRunEntity } from './workflow-run.entity'
import { WorkflowLeadEntity } from './workflow-lead.entity'

@Entity('leads')
@Index('uq_leads_owner_normalized_domain', ['ownerUserId', 'normalizedDomain'], { unique: true })
@Index('idx_leads_owner_status', ['ownerUserId', 'status'])
@Index('idx_leads_team_id', ['teamId'])
@Index('idx_leads_workflow_run_id', ['workflowRunId'])
@Index('idx_leads_domain', ['domain'])
@Index('idx_leads_created_at', ['createdAt'])
@Check(
  'chk_leads_scores',
  'shopify_confidence BETWEEN 0 AND 100 AND ad_activity_score BETWEEN 0 AND 100 AND traffic_score BETWEEN 0 AND 100 AND contact_score BETWEEN 0 AND 100 AND total_score BETWEEN 0 AND 100',
)
export class LeadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid', nullable: true })
  workflowRunId: string | null

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ name: 'brand_name', length: 160 })
  brandName: string

  @Column({ length: 255 })
  domain: string

  @Column({ name: 'normalized_domain', length: 255 })
  normalizedDomain: string

  @Column({ name: 'store_url', length: 500 })
  storeUrl: string

  @Column({ length: 120 })
  source: string

  @Column({ length: 80, default: '' })
  country: string

  @Column({ length: 40, default: 'English' })
  language: string

  @Column({ length: 120, default: '' })
  category: string

  @Column({ name: 'shopify_confidence', type: 'double precision', default: 0 })
  shopifyConfidence: number

  @Column({ name: 'ad_activity_score', type: 'double precision', default: 0 })
  adActivityScore: number

  @Column({ name: 'traffic_score', type: 'double precision', default: 0 })
  trafficScore: number

  @Column({ name: 'contact_score', type: 'double precision', default: 0 })
  contactScore: number

  @Column({ name: 'total_score', type: 'double precision', default: 0 })
  totalScore: number

  @Column({
    type: 'enum',
    enum: LEAD_STATUSES,
    enumName: 'autoflow_lead_status_enum',
    default: 'new',
  })
  status: LeadStatus

  @Column({ name: 'recommended_angle', type: 'text', default: '' })
  recommendedAngle: string

  @ManyToOne(() => WorkflowRunEntity, (workflowRun) => workflowRun.leads, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_leads_workflow_run' })
  workflowRun: WorkflowRunEntity | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_leads_owner' })
  owner: User

  @OneToMany(() => LeadContactEntity, (contact) => contact.lead)
  contacts: LeadContactEntity[]

  @OneToMany(() => OutreachTaskEntity, (task) => task.lead)
  outreachTasks: OutreachTaskEntity[]

  @OneToMany(() => CrmActivityEntity, (activity) => activity.lead)
  activities: CrmActivityEntity[]

  @OneToMany(() => WorkflowLeadEntity, (link) => link.lead)
  workflowLinks: WorkflowLeadEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
