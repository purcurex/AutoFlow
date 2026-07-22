import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm'
import { User } from '../users/user.entity'
import { Folder } from '../folders/folder.entity'
import { LeadEntity } from '../autoflow/entities/lead.entity'
import { WorkflowRunEntity } from '../autoflow/entities/workflow-run.entity'

export enum EditorType {
  MARKDOWN = 'markdown',
  RICHTEXT = 'richtext',
}

@Entity('notes')
@Index('idx_notes_user_id', ['userId'])
@Index('idx_notes_folder_id', ['folderId'])
@Index('idx_notes_workflow_run_id', ['workflowRunId'])
@Index('idx_notes_lead_id', ['leadId'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id' })
  userId: string

  @Column({ name: 'folder_id', nullable: true })
  folderId: string | null

  @Column({ name: 'workflow_run_id', type: 'uuid', nullable: true })
  workflowRunId: string | null

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null

  @Column({ default: '无标题笔记' })
  title: string

  @Column({ type: 'text', default: '' })
  content: string

  @Column({ name: 'content_html', type: 'text', nullable: true })
  contentHtml: string

  @Column({
    name: 'editor_type',
    type: 'enum',
    enum: EditorType,
    default: EditorType.MARKDOWN,
  })
  editorType: EditorType

  @Column({ type: 'simple-array', default: [] })
  tags: string[]

  @Column({ name: 'is_favorite', default: false })
  isFavorite: boolean

  @Column({ name: 'is_deleted', default: false })
  isDeleted: boolean

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number

  @ManyToOne(() => User, (user) => user.notes)
  @JoinColumn({ name: 'user_id' })
  user: User

  @ManyToOne(() => Folder, (folder) => folder.notes)
  @JoinColumn({ name: 'folder_id' })
  folder: Folder

  @ManyToOne(() => WorkflowRunEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workflow_run_id', foreignKeyConstraintName: 'fk_notes_workflow_run' })
  workflowRun: WorkflowRunEntity | null

  @ManyToOne(() => LeadEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lead_id', foreignKeyConstraintName: 'fk_notes_lead' })
  lead: LeadEntity | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
