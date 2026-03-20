import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm'
import { Note } from '../notes/note.entity'
import { Folder } from '../folders/folder.entity'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ unique: true })
  email: string

  @Column()
  password: string

  @Column({ unique: true })
  username: string

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string

  @OneToMany(() => Note, (note) => note.user)
  notes: Note[]

  @OneToMany(() => Folder, (folder) => folder.user)
  folders: Folder[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
