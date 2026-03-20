import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm'
import { User } from '../users/user.entity'
import { Note } from '../notes/note.entity'

@Entity('folders')
@Index('idx_folders_user_id', ['userId'])
@Index('idx_folders_parent_id', ['parentId'])
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id' })
  userId: string

  @Column({ name: 'parent_id', nullable: true })
  parentId: string | null

  @Column()
  name: string

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number

  @ManyToOne(() => User, (user) => user.folders)
  @JoinColumn({ name: 'user_id' })
  user: User

  @ManyToOne(() => Folder, (folder) => folder.children)
  @JoinColumn({ name: 'parent_id' })
  parent: Folder

  @OneToMany(() => Folder, (folder) => folder.parent)
  children: Folder[]

  @OneToMany(() => Note, (note) => note.folder)
  notes: Note[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
