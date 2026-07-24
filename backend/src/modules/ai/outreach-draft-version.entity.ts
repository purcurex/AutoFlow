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
import { LeadEntity } from '../autoflow/entities/lead.entity'
import { OutreachTaskEntity } from '../autoflow/entities/outreach-task.entity'
import { AiOutreachConversationEntity } from './ai-outreach-conversation.entity'

export const OUTREACH_DRAFT_STATUSES = ['draft', 'accepted', 'superseded'] as const
export type OutreachDraftStatus = (typeof OUTREACH_DRAFT_STATUSES)[number]

@Entity('outreach_draft_versions')
@Unique('uq_outreach_draft_versions_conversation_version', ['conversationId', 'version'])
@Index('idx_outreach_draft_versions_owner_created', ['ownerUserId', 'createdAt'])
export class OutreachDraftVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ name: 'outreach_task_id', type: 'uuid', nullable: true })
  outreachTaskId: string | null

  @Column({ type: 'integer' })
  version: number

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status: OutreachDraftStatus

  @Column({ name: 'english_subject', type: 'varchar', length: 200, default: '' })
  englishSubject: string

  @Column({ name: 'english_message', type: 'text' })
  englishMessage: string

  @Column({ name: 'chinese_subject', type: 'varchar', length: 200, default: '' })
  chineseSubject: string

  @Column({ name: 'chinese_message', type: 'text' })
  chineseMessage: string

  @Column({ name: 'facts_used', type: 'jsonb', default: () => "'[]'::jsonb" })
  factsUsed: string[]

  @Column({ name: 'missing_facts', type: 'jsonb', default: () => "'[]'::jsonb" })
  missingFacts: string[]

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  warnings: string[]

  @ManyToOne(() => AiOutreachConversationEntity, (conversation) => conversation.drafts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'fk_outreach_draft_versions_conversation' })
  conversation: AiOutreachConversationEntity

  @ManyToOne(() => LeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_outreach_draft_versions_lead' })
  lead: LeadEntity

  @ManyToOne(() => OutreachTaskEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'outreach_task_id', foreignKeyConstraintName: 'fk_outreach_draft_versions_task' })
  outreachTask: OutreachTaskEntity | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
