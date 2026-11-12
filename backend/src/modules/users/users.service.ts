import { businessScope } from './business-scope'
import type { UpdateBusinessScopeDto } from './dto/business-scope.dto'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { FOP_DATA_PROVIDER, FopDataProvider } from '../fop-data/fop-data.types'
import { InjectRepository } from '@nestjs/typeorm'
import { ILike, In, IsNull, Repository } from 'typeorm'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import { OrganizationNodeEntity } from '../organization/organization-node.entity'
import * as bcrypt from 'bcrypt'
import { User, UserRole } from './user.entity'
import type { UpdateProfileDto } from './dto/update-profile.dto'
import type { ListWorkbenchAccountsDto } from './dto/workbench.dto'
import { WORKBENCH_ROLES, type WorkbenchRole } from './workbench-role'
import type { FopIdentity } from '../fop-data/fop-data.types'
import { ChartPermissionOverride, collaborationChartPermissions, validateChartPermissions } from './chart-permissions'
import { accountRole } from './account-role'
import { UpdateAccountAccessDto } from './dto/account-access.dto'
import { buildLocalWorkbenchOrganization, LocalWorkbenchOrganization, type LocalWorkbenchCompany } from './local-workbench-organization'

function workbenchAccount(user: User) {
  return {
    id: user.id, displayId: user.displayId, email: user.email, username: user.username, role: user.role, workbenchRoles: user.workbenchRoles,
    businessScope: businessScope(user),
    accountRole: accountRole(user),
    chartPermissions: user.chartPermissions ?? [],
    fopBinding: user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null,
    fopBindingDetails: user.fopBindingDetails ?? null,
  }
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @Optional() private readonly modules?: ModuleRef,
  ) {}

  async create(
    email: string,
    username: string,
    password: string,
    role: UserRole = UserRole.USER,
    displayId?: string,
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = this.usersRepository.create({
      email,
      username,
      password: hashedPassword,
      role,
      displayId,
      workbenchRoles: ['sales'],
      chartPermissions: [],
    })
    return this.usersRepository.save(user)
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find()
  }

  async listWorkbenchAccounts(query: ListWorkbenchAccountsDto) {
    const search = query.search?.trim()
    const pattern = search ? ILike(`%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined
    const roleFilter = query.accountRole === 'administrator' ? { role: UserRole.ADMIN }
      : query.accountRole ? { role: UserRole.USER, businessRole: query.accountRole === 'collaboration' ? In(['admin', 'none']) : query.accountRole } : {}
    const [users, total] = await this.usersRepository.findAndCount({
      select: { id: true, displayId: true, email: true, username: true, role: true, workbenchRoles: true, chartPermissions: true, fopTenantId: true, fopUserId: true, fopBindingDetails: true, businessRole: true, businessDepartmentId: true, businessEmployeeId: true },
      where: pattern ? [{ username: pattern, accountDisabled: false, ...roleFilter }, { email: pattern, accountDisabled: false, ...roleFilter }, { displayId: pattern, accountDisabled: false, ...roleFilter }] : { accountDisabled: false, ...roleFilter },
      order: { displayId: 'ASC', id: 'ASC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    })
    const employees = users.length ? await this.usersRepository.manager.getRepository(OrganizationEmployeeEntity).find({ where: { accountId: In(users.map(user => user.id)) }, relations: { department: true } }) : []
    return { items: users.map(user => {
      const employee = employees.find(row => row.accountId === user.id)
      return { ...workbenchAccount(user), employee: employee ? { id: employee.id, name: employee.name, code: employee.code, department: { id: employee.departmentId, name: employee.department.name } } : null }
    }), total }
  }

  async updateWorkbenchRoles(id: string, workbenchRoles: WorkbenchRole[]) {
    const user = await this.findById(id)
    if (!user) throw new NotFoundException('用户不存在')
    // A partial update cannot overwrite concurrently changed account identity fields.
    await this.usersRepository.update(id, { workbenchRoles: [...workbenchRoles] })
    const updated = await this.findById(id)
    if (!updated) throw new NotFoundException('用户不存在')
    return workbenchAccount(updated)
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } })
  }

  /** 仅通过已绑定租户/认证用户定位当前账号，不按用户名或姓名推测账号归属。 */
  async findByFopIdentity(identity: FopIdentity): Promise<User | null> {
    return this.usersRepository.findOne({ where: { fopTenantId: identity.tenantId, fopUserId: identity.userId } })
  }

  /** 兼容旧解绑入口的响应结构，只返回管理页允许字段，避免返回完整用户实体及密码散列。 */
  async getWorkbenchAccount(id: string) {
    const user = await this.findById(id)
    if (!user) throw new NotFoundException('用户不存在')
    return workbenchAccount(user)
  }

  async workbenchDepartment(user: User): Promise<{ id: string; name: string | null } | null> {
    const scope = businessScope(user)
    if (scope.role === 'admin' || scope.role === 'none') return null
    const employees = await this.usersRepository.manager.getRepository(OrganizationEmployeeEntity).find({
      where: { accountId: user.id, archivedAt: IsNull() },
      select: { ownerUserId: true, departmentId: true }, take: 2,
    })
    if (employees.length > 1 || employees.length === 1 && user.organizationWorkspaceOwnerId && user.organizationWorkspaceOwnerId !== employees[0].ownerUserId) return null
    const ownerUserId = employees.length === 1 ? employees[0].ownerUserId : user.organizationWorkspaceOwnerId
    const departmentId = scope.role === 'salesperson' ? employees[0]?.departmentId : scope.departmentId
    if (!ownerUserId || !departmentId) return null
    const nodes = ownerUserId ? await this.usersRepository.manager.getRepository(OrganizationNodeEntity).find({
      where: { ownerUserId }, select: { id: true, name: true },
    }) : []
    const department = nodes.find(node => node.id === departmentId)
    return department ? { id: department.id, name: department.name } : null
  }

  /** Workbench membership is local; only verified master IDs become upstream filters. */
  async localWorkbenchOrganization(user: User, company?: LocalWorkbenchCompany): Promise<LocalWorkbenchOrganization> {
    const employeesRepository = this.usersRepository.manager.getRepository(OrganizationEmployeeEntity)
    const linked = await employeesRepository.find({ where: { accountId: user.id },
      select: { id: true, ownerUserId: true, archivedAt: true }, take: 2 })
    const invalid = () => new ForbiddenException({ code: 'local_organization_scope_required', message: 'Current local organization assignment is unavailable' })
    if (linked.length > 1 || linked[0]?.archivedAt || linked[0] && user.organizationWorkspaceOwnerId && user.organizationWorkspaceOwnerId !== linked[0].ownerUserId) throw invalid()
    const ownerUserId = linked[0]?.ownerUserId ?? user.organizationWorkspaceOwnerId ?? (businessScope(user).role === 'admin' ? user.id : null)
    if (!ownerUserId) throw invalid()
    const [nodes, employees] = await Promise.all([
      this.usersRepository.manager.getRepository(OrganizationNodeEntity).find({ where: { ownerUserId },
        select: { id: true, ownerUserId: true, parentId: true, name: true, kind: true } }),
      employeesRepository.find({ where: { ownerUserId, archivedAt: IsNull() },
        select: { id: true, ownerUserId: true, departmentId: true, name: true, accountId: true, archivedAt: true } }),
    ])
    const accountIds = [...new Set(employees.flatMap(employee => employee.accountId ? [employee.accountId] : []))]
    const accounts = accountIds.length ? await this.usersRepository.find({ where: { id: In(accountIds) },
      select: { id: true, accountDisabled: true, fopTenantId: true, fopUserId: true, fopBindingDetails: true } }) : []
    return buildLocalWorkbenchOrganization(user, ownerUserId, nodes, employees, accounts, company)
  }

  async defaultProcurementView(user: User): Promise<'fulfillment' | 'purchase'> {
    // Workbench grants describe navigation access, not the employee's actual job.
    if (user.role === UserRole.ADMIN || businessScope(user).role !== 'admin') return 'fulfillment'
    const employees = await this.usersRepository.manager.getRepository(OrganizationEmployeeEntity).find({
      where: { accountId: user.id, archivedAt: IsNull() },
      select: { id: true, ownerUserId: true, departmentId: true, jobTitle: true },
      take: 2,
    })
    if (employees.length !== 1) return 'fulfillment'
    const employee = employees[0]
    const nodes = await this.usersRepository.manager.getRepository(OrganizationNodeEntity).find({
      where: { ownerUserId: employee.ownerUserId },
      select: { id: true, parentId: true, name: true },
    })
    const byId = new Map(nodes.map(node => [node.id, node]))
    const names: string[] = [], visited = new Set<string>()
    let id: string | null = employee.departmentId
    while (id && !visited.has(id)) {
      visited.add(id)
      const node = byId.get(id)
      if (!node) break
      names.push(node.name)
      id = node.parentId
    }
    if (names.includes('营销中心')) return 'fulfillment'
    return names.some(name => /采购/.test(name)) || /采购/.test(employee.jobTitle) ? 'purchase' : 'fulfillment'
  }

  async updateAccountAccess(actorId: string, id: string, input: UpdateAccountAccessDto) {
    // 管理员固定全部本地业务范围，兼容历史客户端提交的关闭/本人/部门范围。
    const scope = input.accountRole === 'administrator'
      ? { ...input.businessScope, role: 'admin' as const } : input.businessScope
    const valid = input.accountRole === 'administrator'
      || input.accountRole === 'collaboration' && ['admin', 'none'].includes(scope.role)
      || input.accountRole === scope.role && ['salesperson', 'department_manager'].includes(scope.role)
    if (!valid) throw new BadRequestException('角色与数据范围不一致')
    return this.usersRepository.manager.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
      const repository = manager.getRepository(User)
      const actor = await repository.findOne({ where: { id: actorId }, lock: { mode: 'pessimistic_read' } })
      if (actor?.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator access required')
      const target = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })
      if (!target) throw new NotFoundException('用户不存在')
      const role = input.accountRole === 'administrator' ? UserRole.ADMIN : UserRole.USER
      if (actorId === id && role !== UserRole.ADMIN) throw new ConflictException('不能撤销自己的管理员角色，请由另一位管理员操作')
      const resetTemplate = accountRole(target) !== input.accountRole || target.businessRole === 'none' && scope.role !== 'none'
      await repository.update(id, {
        role, businessRole: scope.role, businessDepartmentId: scope.departmentId, businessEmployeeId: scope.employeeId,
        ...(input.accountRole === 'department_manager' && accountRole(target) !== 'department_manager' ? { dataDisplayScope: 'self' as const } : {}),
        workbenchRoles: input.accountRole === 'administrator' ? [...WORKBENCH_ROLES] : [...input.workbenchRoles],
        ...(resetTemplate ? { chartPermissions: input.accountRole === 'collaboration' ? collaborationChartPermissions() : [] } : {}),
      })
      return workbenchAccount((await repository.findOne({ where: { id } }))!)
    })
  }

  async updateManagementRole(actorId: string, id: string, role: UserRole) {
    return this.usersRepository.manager.transaction(async (manager) => {
      // Serialize role mutations and recheck the acting administrator inside the
      // lock, so concurrent demotions cannot remove every management account.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
      const repository = manager.getRepository(User)
      const actor = await repository.findOneBy({ id: actorId })
      if (actor?.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator access required')
      if (actorId === id && role !== UserRole.ADMIN) throw new ConflictException('不能撤销自己的系统管理权限，请由另一位管理员操作')
      const target = await repository.findOneBy({ id })
      if (!target) throw new NotFoundException('用户不存在')
      // 旧入口只指定系统角色；撤销管理员时关闭业务，之后再显式选择岗位范围。
      await repository.update(id, { role, ...(role === UserRole.ADMIN
        ? { businessRole: 'admin' as const, workbenchRoles: [...WORKBENCH_ROLES] }
        : target.role === UserRole.ADMIN ? { businessRole: 'none' as const, workbenchRoles: [] } : {}) })
      return workbenchAccount((await repository.findOneBy({ id }))!)
    })
  }

  async updateChartPermissions(actorId: string, id: string, chartPermissions: ChartPermissionOverride[]) {
    if (!validateChartPermissions(chartPermissions)) throw new BadRequestException('Invalid chart permissions')
    const permissions = chartPermissions.map(row => ({ ...row, summaryDepartments: [...row.summaryDepartments] }))
    return this.usersRepository.manager.transaction(async (manager) => {
      // Use the same lock as management-role mutations. A stale controller check
      // cannot authorize an administrator who was demoted while waiting to save.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
      const repository = manager.getRepository(User)
      const actor = await repository.findOne({ where: { id: actorId }, lock: { mode: 'pessimistic_read' } })
      if (actor?.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator access required')
      const target = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })
      if (!target) throw new NotFoundException('用户不存在')
      // Partial writes preserve business roles, workbench grants and FOP identity.
      await repository.update(id, { chartPermissions: permissions })
      return workbenchAccount((await repository.findOne({ where: { id } }))!)
    })
  }

  async updateBusinessScope(id: string, scope: UpdateBusinessScopeDto) {
    const current = await this.findById(id)
    if (!current) throw new NotFoundException('用户不存在')
    await this.usersRepository.update(id, { businessRole: scope.role, businessDepartmentId: scope.departmentId, businessEmployeeId: scope.employeeId,
      ...(scope.role === 'department_manager' && current.businessRole !== 'department_manager' ? { dataDisplayScope: 'self' as const } : {}) })
    const updated = await this.findById(id)
    if (!updated) throw new NotFoundException('用户不存在')
    return workbenchAccount(updated)
  }

  async updateFopBinding(id: string, tenantId: string | null, userId: string | null) {
    if (!await this.findById(id)) throw new NotFoundException('用户不存在')
    if ((tenantId || userId) && this.modules?.get<FopDataProvider>(FOP_DATA_PROVIDER, { strict: false }).supportsEmployeeBinding) {
      throw new BadRequestException('请从组织架构的账号资料中选择并验证金蝶员工')
    }
    try {
      await this.usersRepository.update(id, { fopTenantId: tenantId, fopUserId: userId, fopBindingDetails: null })
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw new ConflictException('This FOP identity is already bound to another account')
      }
      throw error
    }
    const updated = await this.findById(id)
    if (!updated) throw new NotFoundException('用户不存在')
    return workbenchAccount(updated)
  }

  /** 管理员自助接入采用条件更新，角色撤销或原绑定并发变化时不覆盖；沿用身份唯一约束。 */
  async connectCurrentAdminFop(id: string, previous: FopIdentity | null, subject: FopIdentity) {
    try {
      const result = await this.usersRepository.update({ id, role: UserRole.ADMIN, businessRole: 'admin',
        fopTenantId: previous?.tenantId ?? IsNull(), fopUserId: previous?.userId ?? IsNull() },
      { fopTenantId: subject.tenantId, fopUserId: subject.userId })
      if (result.affected !== 1) throw new ForbiddenException({ code: 'fop_binding_changed', message: 'Account access or binding changed; reload before continuing' })
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new ConflictException('This FOP identity is already bound to another account')
      throw error
    }
    const user = await this.findById(id)
    if (!user) throw new NotFoundException('用户不存在')
    return workbenchAccount(user)
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } })
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } })
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return this.usersRepository.find({ where: { role } })
  }

  async updateProfile(id: string, updateData: UpdateProfileDto): Promise<User> {
    const user = await this.findById(id)
    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    // Never save a full profile snapshot: grants may have changed since the read.
    const changes: Partial<Pick<User, 'username' | 'avatarUrl' | 'dataDisplayScope'>> = {}
    if (updateData.username !== undefined) changes.username = updateData.username
    if (updateData.avatarUrl !== undefined) changes.avatarUrl = updateData.avatarUrl
    if (updateData.dataDisplayScope !== undefined) {
      if (user.role !== UserRole.USER || user.businessRole !== 'department_manager' || user.accountDisabled) {
        throw new ForbiddenException('只有部门经理可以切换数据展示范围')
      }
      if (!['department', 'self'].includes(updateData.dataDisplayScope)) throw new BadRequestException('无效的数据展示范围')
      changes.dataDisplayScope = updateData.dataDisplayScope
      // Check the role again in the write, so a concurrent demotion cannot save this preference.
      const result = await this.usersRepository.update({ id, role: UserRole.USER, businessRole: 'department_manager', accountDisabled: false }, changes)
      if (result.affected !== 1) throw new ForbiddenException('账号权限已变更，请刷新后重试')
    } else if (Object.keys(changes).length) await this.usersRepository.update(id, changes)
    const updated = await this.findById(id)
    if (!updated) throw new NotFoundException('用户不存在')
    return updated
  }

  async updateAvatar(id: string, avatarUrl: string): Promise<User> {
    return this.updateProfile(id, { avatarUrl })
  }

  async delete(id: string): Promise<void> {
    const user = await this.findById(id)
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    await this.usersRepository.remove(user)
  }

  async validatePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword)
  }
}
