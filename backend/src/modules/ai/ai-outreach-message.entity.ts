import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm'
import { AiOutreachConversationEntity } from './ai-outreach-conversation.entity'

export const AI_OUTREACH_MESSAGE_ROLES = ['user', 'assistant'] as const
export type AiOutreachMessageRole = (typeof AI_OUTREACH_MESSAGE_ROLES)[number]

@Entity('ai_outreach_messages')
@Unique('uq_ai_outreach_messages_conversation_sequence', ['conversationId', 'sequence'])
@Index('idx_ai_outreach_messages_conversation_created', ['conversationId', 'createdAt'])
export class AiOutreachMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ type: 'varchar', length: 16 })
  role: AiOutreachMessageRole

  @Column({ type: 'integer' })
  sequence: number

  @Column({ type: 'text' })
  content: string

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>

  @ManyToOne(() => AiOutreachConversationEntity, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'fk_ai_outreach_messages_conversation' })
  conversation: AiOutreachConversationEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
