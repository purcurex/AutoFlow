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
import {
  SEED_TYPES,
  WORKFLOW_STAGES,
  WORKFLOW_STATUSES,
  type SeedType,
  type WorkflowStage,
  type WorkflowStatus,
} from '../autoflow.types'
import { LeadEntity } from './lead.entity'
import { WorkflowStepEntity } from './workflow-step.entity'
import { WorkflowLeadEntity } from './workflow-lead.entity'
import { WorkflowJobEntity } from './workflow-job.entity'

@Entity('workflow_runs')
@Index('idx_workflow_runs_owner_created_at', ['ownerUserId', 'createdAt'])
@Index('idx_workflow_runs_team_id', ['teamId'])
@Index('idx_workflow_runs_status', ['status'])
@Index('idx_workflow_runs_updated_at', ['updatedAt'])
@Check('chk_workflow_runs_progress', 'progress >= 0 AND progress <= 100')
export class WorkflowRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ length: 120 })
  name: string

  @Column({ name: 'seed_type', type: 'enum', enum: SEED_TYPES, enumName: 'autoflow_seed_type_enum' })
  seedType: SeedType

  @Column({ name: 'seed_value', length: 500 })
  seedValue: string

  @Column({ name: 'target_market', length: 80, default: 'United States' })
  targetMarket: string

  @Column({
    type: 'enum',
    enum: WORKFLOW_STATUSES,
    enumName: 'autoflow_workflow_status_enum',
    default: 'draft',
  })
  status: WorkflowStatus

  @Column({
    name: 'current_stage',
    type: 'enum',
    enum: WORKFLOW_STAGES,
    enumName: 'autoflow_workflow_stage_enum',
    default: 'seed',
  })
  currentStage: WorkflowStage

  @Column({ type: 'integer', default: 0 })
  progress: number

  @Column({ name: 'lead_count', type: 'integer', default: 0 })
  leadCount: number

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_workflow_runs_owner' })
  owner: User

  @OneToMany(() => WorkflowStepEntity, (step) => step.workflowRun)
  steps: WorkflowStepEntity[]

  @OneToMany(() => LeadEntity, (lead) => lead.workflowRun)
  leads: LeadEntity[]

  @OneToMany(() => WorkflowLeadEntity, (link) => link.workflowRun)
  leadLinks: WorkflowLeadEntity[]

  @OneToMany(() => WorkflowJobEntity, (job) => job.workflowRun)
  jobs: WorkflowJobEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
