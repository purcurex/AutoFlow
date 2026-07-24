import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { User } from '../users/user.entity'
import type { AiPromptModuleKey } from './prompt-template.types'

@Entity('ai_prompt_templates')
@Index('idx_ai_prompt_templates_owner_module', ['ownerUserId', 'moduleKey'])
@Index('uq_ai_prompt_templates_owner_module_name', ['ownerUserId', 'moduleKey', 'name'], { unique: true })
export class AiPromptTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null

  @Column({ name: 'module_key', type: 'varchar', length: 40 })
  moduleKey: AiPromptModuleKey

  @Column({ type: 'varchar', length: 80 })
  name: string

  @Column({ type: 'text' })
  content: string

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_ai_prompt_templates_owner' })
  owner: User | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
