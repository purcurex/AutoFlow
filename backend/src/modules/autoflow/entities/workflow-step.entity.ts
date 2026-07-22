import {
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
import {
  WORKFLOW_STAGES,
  WORKFLOW_STEP_STATUSES,
  type WorkflowStage,
  type WorkflowStepStatus,
} from '../autoflow.types'
import { WorkflowRunEntity } from './workflow-run.entity'

@Entity('workflow_steps')
@Unique('uq_workflow_steps_run_stage', ['workflowRunId', 'stage'])
@Index('idx_workflow_steps_run_sequence', ['workflowRunId', 'sequence'])
@Index('idx_workflow_steps_status', ['status'])
@Index('idx_workflow_steps_updated_at', ['updatedAt'])
export class WorkflowStepEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ type: 'enum', enum: WORKFLOW_STAGES, enumName: 'autoflow_workflow_stage_enum' })
  stage: WorkflowStage

  @Column({
    type: 'enum',
    enum: WORKFLOW_STEP_STATUSES,
    enumName: 'autoflow_workflow_step_status_enum',
    default: 'pending',
  })
  status: WorkflowStepStatus

  @Column({ type: 'integer' })
  sequence: number

  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, unknown> | null

  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, unknown> | null

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null

  @ManyToOne(() => WorkflowRunEntity, (workflowRun) => workflowRun.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_workflow_steps_run' })
  workflowRun: WorkflowRunEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
