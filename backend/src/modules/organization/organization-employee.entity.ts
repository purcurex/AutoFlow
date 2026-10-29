import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'
import { User } from '../users/user.entity'
import type { WorkbenchRole } from '../users/workbench-role'
import { OrganizationNodeEntity } from './organization-node.entity'
import type { DirectoryProfile } from './company-directory'

@Entity('organization_employees')
@Unique('uq_organization_employees_owner_code', ['ownerUserId', 'code'])
@Index('idx_organization_employees_owner_department', ['ownerUserId', 'departmentId'])
@Check('chk_organization_employees_roles', "workbench_roles <@ ARRAY['sales','procurement','allocation','dispatch','warehouse']::text[] AND cardinality(workbench_roles) <= 5")
export class OrganizationEmployeeEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'owner_user_id', type: 'uuid' }) ownerUserId: string
  @Column({ name: 'department_id', type: 'uuid' }) departmentId: string
  @Column({ name: 'account_id', type: 'uuid', nullable: true }) accountId: string | null
  @Column({ type: 'varchar', length: 100 }) name: string
  @Column({ type: 'varchar', length: 40 }) code: string
  @Column({ type: 'varchar', length: 160 }) email: string
  @Column({ name: 'job_title', type: 'varchar', length: 100, default: '' }) jobTitle: string
  @Column({ name: 'directory_profile', type: 'jsonb', nullable: true }) directoryProfile: DirectoryProfile | null
  @Column({ type: 'varchar', length: 40, default: '' }) phone: string
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) archivedAt: Date | null
  @Column({ name: 'workbench_roles', type: 'text', array: true }) workbenchRoles: WorkbenchRole[]
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' }) owner: User

  @ManyToOne(() => OrganizationNodeEntity)
  @JoinColumn([{ name: 'department_id', referencedColumnName: 'id' }, { name: 'owner_user_id', referencedColumnName: 'ownerUserId' }])
  department: OrganizationNodeEntity
}
