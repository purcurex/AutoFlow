import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Unique,
} from 'typeorm'
import type { BusinessRole } from './business-scope'
import { Note } from '../notes/note.entity'
import { Folder } from '../folders/folder.entity'
import type { WorkbenchRole } from './workbench-role'
import type { ChartPermissionOverride } from './chart-permissions'

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Entity('users')
@Check('chk_users_chart_permissions', 'autoflow_valid_chart_permissions(chart_permissions)')
@Check('chk_users_business_role', "business_role IN ('none','admin','department_manager','salesperson')")
@Check('chk_users_business_ids', "(business_department_id IS NULL OR (char_length(business_department_id) > 0 AND business_department_id = btrim(business_department_id))) AND (business_employee_id IS NULL OR (char_length(business_employee_id) > 0 AND business_employee_id = btrim(business_employee_id)))")
@Unique('uq_users_fop_identity', ['fopTenantId', 'fopUserId'])
@Check('chk_users_fop_identity', `
  (fop_tenant_id IS NULL AND fop_user_id IS NULL) OR (
    fop_tenant_id IS NOT NULL AND fop_user_id IS NOT NULL
    AND char_length(fop_tenant_id) BETWEEN 1 AND 128
    AND char_length(fop_user_id) BETWEEN 1 AND 128
    AND fop_tenant_id !~ '^[[:space:]]|[[:space:]]$'
    AND fop_user_id !~ '^[[:space:]]|[[:space:]]$'
  )
`)
@Check('chk_users_workbench_roles', `
  workbench_roles <@ ARRAY['sales', 'procurement', 'allocation', 'dispatch', 'warehouse']::text[]
  AND cardinality(workbench_roles) = (
    CASE WHEN 'sales' = ANY(workbench_roles) THEN 1 ELSE 0 END +
    CASE WHEN 'procurement' = ANY(workbench_roles) THEN 1 ELSE 0 END +
    CASE WHEN 'allocation' = ANY(workbench_roles) THEN 1 ELSE 0 END +
    CASE WHEN 'dispatch' = ANY(workbench_roles) THEN 1 ELSE 0 END +
    CASE WHEN 'warehouse' = ANY(workbench_roles) THEN 1 ELSE 0 END
  )
`)
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

  @Column({ name: 'account_disabled', default: false }) accountDisabled: boolean
  // Explicit server-maintained directory link for non-employee administrators.
  @Column({ name: 'organization_workspace_owner_id', type: 'uuid', nullable: true }) organizationWorkspaceOwnerId: string | null
  @Column({ name: 'session_version', type: 'integer', default: 0 }) sessionVersion: number

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

  @Column({ name: 'workbench_roles', type: 'text', array: true, default: () => "ARRAY['sales']::text[]" })
  workbenchRoles: WorkbenchRole[]

  @Column({ name: 'chart_permissions', type: 'jsonb', default: () => "'[]'::jsonb" })
  chartPermissions: ChartPermissionOverride[]

  @Column({ name: 'business_role', type: 'varchar', length: 24, default: 'salesperson' })
  businessRole: BusinessRole

  @Column({ name: 'business_department_id', type: 'varchar', length: 128, nullable: true })
  businessDepartmentId: string | null

  @Column({ name: 'business_employee_id', type: 'varchar', length: 128, nullable: true })
  businessEmployeeId: string | null

  @Column({ name: 'fop_tenant_id', type: 'varchar', length: 128, nullable: true })
  fopTenantId: string | null

  @Column({ name: 'fop_user_id', type: 'varchar', length: 128, nullable: true })
  fopUserId: string | null

  @OneToMany(() => Note, (note) => note.user)
  notes: Note[]

  @OneToMany(() => Folder, (folder) => folder.user)
  folders: Folder[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
