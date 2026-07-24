import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm'
import { Note } from '../notes/note.entity'
import { Folder } from '../folders/folder.entity'

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Entity('users')
@Check(
  'chk_users_next_workflow_number',
  'next_workflow_number >= 1 AND next_workflow_number <= 1000000',
)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({
    name: 'display_id',
    type: 'varchar',
    length: 6,
    unique: true,
    default: () => "LPAD(nextval('users_display_id_seq')::text, 6, '0')",
  })
  displayId: string

  @Column({
    name: 'next_workflow_number',
    type: 'integer',
    default: 1,
    select: false,
  })
  nextWorkflowNumber: number

  @Column({ unique: true })
  email: string

  @Column()
  password: string

  @Column({ unique: true })
  username: string

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole

  @OneToMany(() => Note, (note) => note.user)
  notes: Note[]

  @OneToMany(() => Folder, (folder) => folder.user)
  folders: Folder[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
