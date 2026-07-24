import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'
import { User } from '../users/user.entity'
import type { AiPromptModuleKey } from './prompt-template.types'
import { AiPromptTemplateEntity } from './ai-prompt-template.entity'

@Entity('ai_prompt_bindings')
@Unique('uq_ai_prompt_bindings_owner_module', ['ownerUserId', 'moduleKey'])
export class AiPromptBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string

  @Column({ name: 'module_key', type: 'varchar', length: 40 })
  moduleKey: AiPromptModuleKey

  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_ai_prompt_bindings_owner' })
  owner: User

  @ManyToOne(() => AiPromptTemplateEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id', foreignKeyConstraintName: 'fk_ai_prompt_bindings_template' })
  template: AiPromptTemplateEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
