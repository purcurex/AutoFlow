import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { User } from '../users/user.entity'

@Entity('audit_events')
@Index('idx_audit_events_actor_created_at', ['actorUserId', 'createdAt'])
@Index('idx_audit_events_correlation_id', ['correlationId'])
@Index('idx_audit_events_action_created_at', ['action', 'createdAt'])
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null

  @Column({ type: 'varchar', length: 120 })
  action: string

  @Column({ name: 'target_type', type: 'varchar', length: 120 })
  targetType: string

  @Column({ name: 'target_id', type: 'varchar', length: 200, nullable: true })
  targetId: string | null

  @Column({ type: 'varchar', length: 24 })
  outcome: 'succeeded' | 'failed'

  @Column({ name: 'correlation_id', type: 'varchar', length: 80 })
  correlationId: string

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id', foreignKeyConstraintName: 'fk_audit_events_actor' })
  actor: User | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
