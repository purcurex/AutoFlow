import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { User } from '../../users/user.entity'
import {
  OUTREACH_CHANNELS,
  OUTREACH_STATUSES,
  type OutreachChannel,
  type OutreachStatus,
} from '../autoflow.types'
import { LeadEntity } from './lead.entity'

@Entity('outreach_tasks')
@Index('idx_outreach_tasks_lead_id', ['leadId'])
@Index('idx_outreach_tasks_owner_status', ['ownerUserId', 'status'])
@Index('idx_outreach_tasks_team_id', ['teamId'])
@Index('idx_outreach_tasks_next_follow_up_at', ['nextFollowUpAt'])
@Index('idx_outreach_tasks_created_at', ['createdAt'])
@Index('idx_outreach_tasks_template_key', ['templateKey'])
export class OutreachTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({
    type: 'enum',
    enum: OUTREACH_CHANNELS,
    enumName: 'autoflow_outreach_channel_enum',
  })
  channel: OutreachChannel

  @Column({
    type: 'enum',
    enum: OUTREACH_STATUSES,
    enumName: 'autoflow_outreach_status_enum',
    default: 'draft',
  })
  status: OutreachStatus

  @Column({ type: 'text' })
  message: string

  @Column({ name: 'target_contact', type: 'varchar', length: 500, nullable: true })
  targetContact: string | null

  @Column({ type: 'varchar', length: 200, nullable: true })
  subject: string | null

  @Column({ name: 'template_key', type: 'varchar', length: 80 })
  templateKey: string

  @Column({ name: 'next_follow_up_at', type: 'timestamptz', nullable: true })
  nextFollowUpAt: Date | null

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt: Date | null

  @ManyToOne(() => LeadEntity, (lead) => lead.outreachTasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_outreach_tasks_lead' })
  lead: LeadEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_outreach_tasks_owner' })
  owner: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
