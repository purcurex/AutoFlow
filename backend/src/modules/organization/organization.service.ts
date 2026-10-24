import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as bcrypt from 'bcrypt'
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm'
import { User, UserRole } from '../users/user.entity'
import { OrganizationNodeEntity } from './organization-node.entity'
import { OrganizationEmployeeEntity } from './organization-employee.entity'
import { ORGANIZATION_EMPLOYEE_SEEDS, ORGANIZATION_NODE_SEEDS } from './organization.seed'
import type { OrganizationWorkspace } from './organization.types'
import type { CreateEmployeeAccountDto, CreateOrganizationEmployeeDto, CreateOrganizationNodeDto, EmployeeProfileDto, UpdateEmployeeAccountDto, UpdateOrganizationEmployeeDto, UpdateOrganizationNodeDto } from './organization.dto'

@Injectable()
export class OrganizationService {
  constructor(private readonly dataSource: DataSource) {}

  /** Internal demo-provider entrypoint; never exposed directly to HTTP callers. */
  getWorkspace(ownerUserId: string): Promise<OrganizationWorkspace> {
    return this.withWorkspace(ownerUserId, async () => undefined, false)
  }

  getManagementWorkspace(ownerUserId: string): Promise<OrganizationWorkspace> {
    return this.withWorkspace(ownerUserId, async () => undefined)
  }

  createNode(ownerUserId: string, dto: CreateOrganizationNodeDto) {
    return this.withWorkspace(ownerUserId, async (manager, ownerUserId) => {
      await this.requireNode(manager, ownerUserId, dto.parentId)
      await manager.getRepository(OrganizationNodeEntity).insert({
        ownerUserId, parentId: dto.parentId, name: dto.name, kind: 'department', sortOrder: dto.sortOrder ?? 0,
      })
    })
  }

  updateNode(ownerUserId: string, id: string, dto: UpdateOrganizationNodeDto) {
    return this.withWorkspace(ownerUserId, async (manager, ownerUserId) => {
      const node = await this.requireNode(manager, ownerUserId, id)
      const changes: Partial<Pick<OrganizationNodeEntity, 'name' | 'parentId' | 'sortOrder'>> = {}
      if (dto.name !== undefined) changes.name = dto.name
      if (dto.sortOrder !== undefined) changes.sortOrder = dto.sortOrder
      if (dto.parentId !== undefined && dto.parentId !== node.parentId) {
        if (node.kind === 'organization') throw new ConflictException('The root organization cannot be reparented')
        let ancestor: OrganizationNodeEntity | null = await this.requireNode(manager, ownerUserId, dto.parentId)
        const seen = new Set<string>()
        while (ancestor) {
          if (ancestor.id === node.id || seen.has(ancestor.id)) throw new ConflictException('A department cannot be moved beneath itself or its descendants')
          seen.add(ancestor.id)
          ancestor = ancestor.parentId ? await this.requireNode(manager, ownerUserId, ancestor.parentId) : null
        }
        changes.parentId = dto.parentId
      }
      if (Object.keys(changes).length) await manager.getRepository(OrganizationNodeEntity).update({ id, ownerUserId }, changes)
    })
  }

  deleteNode(ownerUserId: string, id: string) {
    return this.withWorkspace(ownerUserId, async (manager, ownerUserId) => {
      const node = await this.requireNode(manager, ownerUserId, id)
      if (node.kind === 'organization') throw new ConflictException('The root organization cannot be deleted')
      if (await manager.getRepository(OrganizationNodeEntity).existsBy({ ownerUserId, parentId: id })
        || await manager.getRepository(OrganizationEmployeeEntity).existsBy({ ownerUserId, departmentId: id })) {
        throw new ConflictException('Move all child departments and employees before deleting this department')
      }
      await manager.getRepository(OrganizationNodeEntity).delete({ id, ownerUserId })
    })
  }

  assignEmployee(ownerUserId: string, id: string, departmentId: string) {
    return this.withWorkspace(ownerUserId, async (manager, ownerUserId) => {
      const employee = await manager.getRepository(OrganizationEmployeeEntity).findOneBy({ id, ownerUserId, archivedAt: IsNull() })
      if (!employee) throw new NotFoundException('Employee not found')
      const department = await this.requireNode(manager, ownerUserId, departmentId)
      if (department.kind !== 'department') throw new ConflictException('Employees must be assigned to a department')
      await manager.getRepository(OrganizationEmployeeEntity).update({ id, ownerUserId }, { departmentId })
      // Only track a local personal assignment; never rewrite manager scopes or FOP mappings.
      if (employee.accountId) await manager.getRepository(User).update({ id: employee.accountId, businessRole: 'salesperson', businessEmployeeId: id, businessDepartmentId: employee.departmentId }, { businessDepartmentId: departmentId })
    })
  }

  createEmployee(actorId: string, dto: CreateOrganizationEmployeeDto) {
    return this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const employee = await this.insertEmployee(manager, ownerUserId, dto)
      if (dto.account) await this.openAccount(manager, employee, dto.account)
    })
  }

  createEmployeeAccount(actorId: string, id: string, dto: CreateEmployeeAccountDto) {
    return this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const employee = await manager.getRepository(OrganizationEmployeeEntity).findOneBy({ id, ownerUserId, archivedAt: IsNull() })
      if (!employee) throw new NotFoundException('Employee not found')
      await this.openAccount(manager, employee, dto)
    })
  }

  private async insertEmployee(manager: EntityManager, ownerUserId: string, dto: UpdateOrganizationEmployeeDto) {
    const department = await this.requireNode(manager, ownerUserId, dto.departmentId)
    if (department.kind !== 'department') throw new ConflictException('请选择员工所属部门，不能选择根组织')
    const repository = manager.getRepository(OrganizationEmployeeEntity)
    await this.requireUniqueEmployee(manager, ownerUserId, dto)
    return repository.save(repository.create({ ownerUserId, name: dto.name, code: dto.code, email: dto.email, jobTitle: dto.jobTitle ?? '', phone: dto.phone ?? '', departmentId: dto.departmentId, workbenchRoles: dto.workbenchRoles, accountId: null, archivedAt: null }))
  }

  private async requireUniqueEmployee(manager: EntityManager, ownerUserId: string, dto: EmployeeProfileDto, exceptId?: string) {
    const matches = await manager.getRepository(OrganizationEmployeeEntity).find({ where: [{ ownerUserId, code: dto.code }, { ownerUserId, email: dto.email }] })
    if (matches.some(row => row.id !== exceptId)) throw new ConflictException('员工编号或邮箱已存在（含已删除成员），请核对后重试')
  }

  updateEmployee(actorId: string, id: string, dto: UpdateOrganizationEmployeeDto) {
    return this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const employees = manager.getRepository(OrganizationEmployeeEntity)
      const employee = await employees.findOneBy({ id, ownerUserId, archivedAt: IsNull() })
      if (!employee) throw new NotFoundException('Employee not found')
      const department = await this.requireNode(manager, ownerUserId, dto.departmentId)
      if (department.kind !== 'department') throw new ConflictException('请选择员工所属部门')
      await this.requireUniqueEmployee(manager, ownerUserId, dto, id)
      if (employee.accountId) {
        await this.requireUniqueAccount(manager, employee.accountId, dto.email)
        await manager.getRepository(User).update(employee.accountId, { email: dto.email })
        await manager.getRepository(User).update({ id: employee.accountId, businessRole: 'salesperson', businessEmployeeId: id, businessDepartmentId: employee.departmentId }, { businessDepartmentId: dto.departmentId })
      }
      await employees.update(id, { name: dto.name, code: dto.code, email: dto.email, jobTitle: dto.jobTitle ?? '', phone: dto.phone ?? '', departmentId: dto.departmentId, workbenchRoles: dto.workbenchRoles })
    })
  }

  importEmployees(actorId: string, departmentId: string, employees: EmployeeProfileDto[]) {
    return this.withWorkspace(actorId, async (manager, ownerUserId) => {
      for (const row of employees) await this.insertEmployee(manager, ownerUserId, { ...row, departmentId, workbenchRoles: [] })
    })
  }

  async validateImportPreview(actorId: string, departmentId: string, preview: { employees: EmployeeProfileDto[]; rowNumbers: number[]; errors: { row: number; message: string }[] }) {
    await this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const department = await this.requireNode(manager, ownerUserId, departmentId)
      if (department.kind !== 'department') throw new ConflictException('请选择员工所属部门')
      if (!preview.employees.length) return
      const existing = await manager.getRepository(OrganizationEmployeeEntity).find({ where: [{ ownerUserId, code: In(preview.employees.map(row => row.code)) }, { ownerUserId, email: In(preview.employees.map(row => row.email)) }] })
      for (const [index, row] of preview.employees.entries()) if (existing.some(employee => employee.code === row.code || employee.email === row.email)) preview.errors.push({ row: preview.rowNumbers[index], message: '该员工编号或邮箱已存在（含已删除成员），请核对后修改文件' })
    })
    return preview
  }

  removeEmployees(actorId: string, ids: string[]) {
    return this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const employees = manager.getRepository(OrganizationEmployeeEntity)
      const rows = await employees.find({ where: { id: In(ids), ownerUserId, archivedAt: IsNull() } })
      if (rows.length !== ids.length) throw new NotFoundException('部分成员不存在或已删除，请刷新清单')
      for (const employee of rows) {
        if (employee.accountId) {
          const user = await manager.getRepository(User).findOneBy({ id: employee.accountId })
          if (user?.id === actorId || user?.role === UserRole.ADMIN) throw new ConflictException('不能删除本人或系统管理员成员，请先由其他管理员调整权限')
          if (user) await manager.getRepository(User).update(user.id, { accountDisabled: true, sessionVersion: () => 'session_version + 1' })
        }
      }
      await employees.update({ id: In(ids), ownerUserId }, { archivedAt: new Date() })
    })
  }

  async getAccount(actorId: string, id: string) {
    let result: ReturnType<OrganizationService['accountDetails']> | undefined
    await this.withWorkspace(actorId, async (manager, ownerUserId) => { result = this.accountDetails(await this.requireEditableAccount(manager, ownerUserId, id)) })
    return result!
  }

  async updateAccount(actorId: string, id: string, dto: UpdateEmployeeAccountDto) {
    let result: ReturnType<OrganizationService['accountDetails']> | undefined
    await this.withWorkspace(actorId, async (manager, ownerUserId) => {
      const account = await this.requireEditableAccount(manager, ownerUserId, id)
      const employee = await manager.getRepository(OrganizationEmployeeEntity).findOneBy({ accountId: id })
      await this.requireUniqueAccount(manager, id, dto.email, dto.username)
      if (employee) {
        await this.requireUniqueEmployee(manager, ownerUserId, { ...employee, email: dto.email }, employee.id)
        await manager.getRepository(OrganizationEmployeeEntity).update(employee.id, { email: dto.email })
      }
      const changes: Partial<Pick<User, 'email' | 'username' | 'password' | 'sessionVersion' | 'fopTenantId' | 'fopUserId'>> = { email: dto.email, username: dto.username }
      if (dto.password !== undefined) { changes.password = await bcrypt.hash(dto.password, 10); changes.sessionVersion = account.sessionVersion + 1 }
      if (dto.fopBinding !== undefined) { changes.fopTenantId = dto.fopBinding?.tenantId ?? null; changes.fopUserId = dto.fopBinding?.userId ?? null }
      await manager.getRepository(User).update(id, changes)
      result = this.accountDetails({ ...account, ...changes })
    })
    return result!
  }

  private accountDetails(user: User) { return { id: user.id, email: user.email, username: user.username, fopBinding: user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null } }

  private async requireEditableAccount(manager: EntityManager, ownerUserId: string, id: string) {
    const user = await manager.getRepository(User).findOneBy({ id, accountDisabled: false })
    if (!user) throw new NotFoundException('Account not found')
    const employee = await manager.getRepository(OrganizationEmployeeEntity).findOneBy({ accountId: id })
    if (employee && (employee.ownerUserId !== ownerUserId || employee.archivedAt)) throw new NotFoundException('Account not found in this directory')
    return user
  }

  private async requireUniqueAccount(manager: EntityManager, id: string, email: string, username?: string) {
    const query = manager.getRepository(User).createQueryBuilder('u').where('u.id <> :id', { id })
    query.andWhere(username ? '(LOWER(u.email) = :email OR u.username = :username)' : 'LOWER(u.email) = :email', { email, username })
    if (await query.getExists()) throw new ConflictException('邮箱或登录名称已存在')
  }

  private async openAccount(manager: EntityManager, employee: OrganizationEmployeeEntity, dto: CreateEmployeeAccountDto) {
    if (employee.accountId) throw new ConflictException('该员工已开通登录账号')
    const users = manager.getRepository(User)
    const email = employee.email.trim().toLowerCase()
    if (await users.createQueryBuilder('account').where('LOWER(account.email) = :email OR account.username = :username', { email, username: dto.username }).getExists()) throw new ConflictException('邮箱或登录名称已存在，请核对现有账号')
    const binding = dto.fopBinding
    const account = await users.save(users.create({ email, username: dto.username, password: await bcrypt.hash(dto.password, 10), role: UserRole.USER,
      workbenchRoles: [...employee.workbenchRoles], chartPermissions: [], businessRole: 'salesperson', businessEmployeeId: employee.id, businessDepartmentId: employee.departmentId,
      fopTenantId: binding?.tenantId ?? null, fopUserId: binding?.userId ?? null }))
    await manager.getRepository(OrganizationEmployeeEntity).update({ id: employee.id, ownerUserId: employee.ownerUserId }, { accountId: account.id, email })
  }

  private async requireNode(manager: EntityManager, ownerUserId: string, id: string) {
    const node = await manager.getRepository(OrganizationNodeEntity).findOneBy({ id, ownerUserId })
    if (!node) throw new NotFoundException('Organization node not found')
    return node
  }

  private withWorkspace(actorId: string, change: (manager: EntityManager, ownerUserId: string) => Promise<void>, requiresAdmin = true): Promise<OrganizationWorkspace> {
    return this.dataSource.transaction(async (manager) => {
      if (requiresAdmin) await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
      const account = await manager.getRepository(User).findOneBy({ id: actorId })
      if (!account || account.accountDisabled) throw new UnauthorizedException('Account no longer exists or is disabled')
      const canEdit = account.role === UserRole.ADMIN
      if (requiresAdmin && !canEdit) throw new ForbiddenException('System administrator access is required for organization management')
      const employee = await manager.getRepository(OrganizationEmployeeEntity).findOneBy({ accountId: actorId })
      const ownerUserId = employee?.ownerUserId ?? actorId
      // Seed and all mutations use the same lock. This serializes reciprocal moves,
      // move/delete races and first-GET creation without locking other accounts.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${ownerUserId}`])
      if (!await manager.getRepository(OrganizationNodeEntity).existsBy({ ownerUserId })) await this.seed(manager, ownerUserId)
      await change(manager, ownerUserId)
      const nodes = await manager.getRepository(OrganizationNodeEntity).find({ where: { ownerUserId }, order: { sortOrder: 'ASC', id: 'ASC' } })
      const archived = requiresAdmin ? await manager.getRepository(OrganizationEmployeeEntity).find({ select: { departmentId: true }, where: { ownerUserId, archivedAt: Not(IsNull()) } }) : []
      const employees = await manager.getRepository(OrganizationEmployeeEntity).find({ where: { ownerUserId, ...(requiresAdmin ? { archivedAt: IsNull() } : {}) }, order: { code: 'ASC', id: 'ASC' } })
      return {
        source: 'mock' as const, canEdit,
        nodes: nodes.map(({ id, parentId, name, kind, sortOrder }) => ({ id, parentId, name, kind, sortOrder, archivedEmployeeCount: archived.filter(employee => employee.departmentId === id).length })),
        employees: employees.map(({ id, name, code, email, departmentId, workbenchRoles, accountId, jobTitle, phone, archivedAt }) => ({ id, name, code, email, departmentId, workbenchRoles, accountId, jobTitle, phone, archivedAt: archivedAt?.toISOString() ?? null })),
      }
    }).catch(error => {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new ConflictException('员工编号、邮箱、登录名称或 FOP 用户已被使用，请核对后重试')
      throw error
    })
  }

  private async seed(manager: EntityManager, ownerUserId: string) {
    const ids = new Map(ORGANIZATION_NODE_SEEDS.map((node) => [node.key as string, randomUUID()]))
    // Parent definitions precede children, so FK validation also succeeds per row.
    for (const [sortOrder, node] of ORGANIZATION_NODE_SEEDS.entries()) {
      await manager.getRepository(OrganizationNodeEntity).insert({
        id: ids.get(node.key), ownerUserId, parentId: node.parent ? ids.get(node.parent)! : null,
        name: node.name, kind: node.parent ? 'department' : 'organization', sortOrder,
      })
    }
    await manager.getRepository(OrganizationEmployeeEntity).insert(ORGANIZATION_EMPLOYEE_SEEDS.map((employee) => {
      const code = employee.code
      return { ownerUserId, name: employee.name, code, email: `${code.toLowerCase()}@hyperzone.example`, departmentId: ids.get(employee.department)!, workbenchRoles: employee.roles }
    }))
  }
}
