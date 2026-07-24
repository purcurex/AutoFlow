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
} from 'typeorm'
import { LeadEntity } from './lead.entity'
import { WorkflowRunEntity } from './workflow-run.entity'

@Entity('workflow_leads')
@Unique('uq_workflow_leads_run_lead', ['workflowRunId', 'leadId'])
@Index('idx_workflow_leads_run_discovered_at', ['workflowRunId', 'discoveredAt'])
@Index('idx_workflow_leads_run_score_discovered', ['workflowRunId', 'sourceScore', 'discoveredAt'])
@Index('idx_workflow_leads_lead_id', ['leadId'])
@Check('chk_workflow_leads_source_score', 'source_score >= 0 AND source_score <= 100')
export class WorkflowLeadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflowRunId: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ length: 120 })
  source: string

  @Column({ name: 'source_reference', type: 'varchar', length: 500, nullable: true })
  sourceReference: string | null

  @Column({ name: 'source_score', type: 'double precision', default: 0 })
  sourceScore: number

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null

  @Column({ name: 'discovered_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  discoveredAt: Date

  @ManyToOne(() => WorkflowRunEntity, (workflowRun) => workflowRun.leadLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_workflow_leads_run' })
  workflowRun: WorkflowRunEntity

  @ManyToOne(() => LeadEntity, (lead) => lead.workflowLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_workflow_leads_lead' })
  lead: LeadEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
