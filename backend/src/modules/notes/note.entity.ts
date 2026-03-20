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

export enum EditorType {
  MARKDOWN = 'markdown',
  RICHTEXT = 'richtext',
}

@Entity('notes')
@Index('idx_notes_user_id', ['userId'])
@Index('idx_notes_folder_id', ['folderId'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id' })
  userId: string

  @Column({ name: 'folder_id', nullable: true })
  folderId: string | null

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
