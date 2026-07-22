import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { User } from '../../users/user.entity'
import {
  CRM_ACTIVITY_TYPES,
  LEAD_STATUSES,
  type CrmActivityType,
  type LeadStatus,
} from '../autoflow.types'
import { LeadEntity } from './lead.entity'

@Entity('crm_activities')
@Index('idx_crm_activities_lead_occurred_at', ['leadId', 'occurredAt'])
@Index('idx_crm_activities_owner_id', ['ownerUserId'])
@Index('idx_crm_activities_team_id', ['teamId'])
@Index('idx_crm_activities_type', ['type'])
@Index('idx_crm_activities_next_follow_up_at', ['nextFollowUpAt'])
export class CrmActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null

  @Column({ type: 'enum', enum: CRM_ACTIVITY_TYPES, enumName: 'autoflow_crm_activity_type_enum' })
  type: CrmActivityType

  @Column({ type: 'varchar', length: 160, nullable: true })
  subject: string | null

  @Column({ type: 'text', default: '' })
  content: string

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: LEAD_STATUSES,
    enumName: 'autoflow_lead_status_enum',
    nullable: true,
  })
  fromStatus: LeadStatus | null

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: LEAD_STATUSES,
    enumName: 'autoflow_lead_status_enum',
    nullable: true,
  })
  toStatus: LeadStatus | null

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  occurredAt: Date

  @Column({ name: 'next_follow_up_at', type: 'timestamptz', nullable: true })
  nextFollowUpAt: Date | null

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null

  @ManyToOne(() => LeadEntity, (lead) => lead.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_crm_activities_lead' })
  lead: LeadEntity

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_crm_activities_owner' })
  owner: User

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
