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
import { WorkflowRunEntity } from './workflow-run.entity'

export const WORKFLOW_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type WorkflowJobStatus = (typeof WORKFLOW_JOB_STATUSES)[number]

@Entity('workflow_jobs')
@Unique('uq_workflow_jobs_workflow_run', ['workflowRunId'])
@Index('idx_workflow_jobs_status_available_at', ['status', 'availableAt'])
@Index('idx_workflow_jobs_lease_expires_at', ['leaseExpiresAt'])
@Index('idx_workflow_jobs_owner_created_at', ['ownerUserId', 'createdAt'])
@Check('chk_workflow_jobs_attempts', 'attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts')
export class WorkflowJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({
    type: 'enum',
    enum: WORKFLOW_JOB_STATUSES,
    enumName: 'autoflow_workflow_job_status_enum',
    default: 'queued',
  })
  status: WorkflowJobStatus

  @Column({ type: 'integer', default: 0 })
  attempts: number

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts: number

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  availableAt: Date

  @Column({ name: 'lease_owner', type: 'varchar', length: 160, nullable: true })
  leaseOwner: string | null

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null

  @ManyToOne(() => WorkflowRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_workflow_jobs_run' })
  workflowRun: WorkflowRunEntity

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_workflow_jobs_owner' })
  owner: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
