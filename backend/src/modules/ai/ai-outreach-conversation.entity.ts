import {
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
import { User } from '../users/user.entity'
import { LeadEntity } from '../autoflow/entities/lead.entity'
import type {
  OutreachChannel,
  OutreachTemplateOptions,
} from '../autoflow/autoflow.types'
import { AiOutreachMessageEntity } from './ai-outreach-message.entity'
import { OutreachDraftVersionEntity } from './outreach-draft-version.entity'

export const AI_OUTREACH_CONVERSATION_STATUSES = [
  'active',
  'drafted',
  'accepted',
  'archived',
] as const
export type AiOutreachConversationStatus = (typeof AI_OUTREACH_CONVERSATION_STATUSES)[number]

export interface AiOutreachConversationOptions extends OutreachTemplateOptions {
  channel: OutreachChannel
  manualTarget?: string | null
  offer: string
  responseLanguage: 'zh-CN' | 'en'
}

@Entity('ai_outreach_conversations')
@Index('idx_ai_outreach_conversations_owner_updated', ['ownerUserId', 'updatedAt'])
@Index('idx_ai_outreach_conversations_lead_updated', ['leadId', 'updatedAt'])
export class AiOutreachConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ type: 'varchar', length: 160 })
  title: string

  @Column({ type: 'varchar', length: 24, default: 'active' })
  status: AiOutreachConversationStatus

  @Column({ type: 'jsonb' })
  options: AiOutreachConversationOptions

  @Column({ name: 'context_snapshot', type: 'jsonb' })
  contextSnapshot: Record<string, unknown>

  @Column({ type: 'text', nullable: true })
  summary: string | null

  @Column({ name: 'last_draft_version', type: 'integer', default: 0 })
  lastDraftVersion: number

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_ai_outreach_conversations_owner' })
  owner: User

  @ManyToOne(() => LeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_ai_outreach_conversations_lead' })
  lead: LeadEntity

  @OneToMany(() => AiOutreachMessageEntity, (message) => message.conversation)
  messages: AiOutreachMessageEntity[]

  @OneToMany(() => OutreachDraftVersionEntity, (draft) => draft.conversation)
  drafts: OutreachDraftVersionEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
