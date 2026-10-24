import { businessScope } from './business-scope'
import type { UpdateBusinessScopeDto } from './dto/business-scope.dto'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ILike, In, Repository } from 'typeorm'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import * as bcrypt from 'bcrypt'
import { User, UserRole } from './user.entity'
import type { UpdateProfileDto } from './dto/update-profile.dto'
import type { ListWorkbenchAccountsDto } from './dto/workbench.dto'
import type { WorkbenchRole } from './workbench-role'
import { ChartPermissionOverride, validateChartPermissions } from './chart-permissions'

function workbenchAccount(user: User) {
  return {
    id: user.id, displayId: user.displayId, email: user.email, username: user.username, role: user.role, workbenchRoles: user.workbenchRoles,
    businessScope: businessScope(user),
    chartPermissions: user.chartPermissions ?? [],
    fopBinding: user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null,
  }
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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
    const [users, total] = await this.usersRepository.findAndCount({
      select: { id: true, displayId: true, email: true, username: true, role: true, workbenchRoles: true, chartPermissions: true, fopTenantId: true, fopUserId: true, businessRole: true, businessDepartmentId: true, businessEmployeeId: true },
      where: pattern ? [{ username: pattern, accountDisabled: false }, { email: pattern, accountDisabled: false }, { displayId: pattern, accountDisabled: false }] : { accountDisabled: false },
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

  async updateManagementRole(actorId: string, id: string, role: UserRole) {
    return this.usersRepository.manager.transaction(async (manager) => {
      // Serialize role mutations and recheck the acting administrator inside the
      // lock, so concurrent demotions cannot remove every management account.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
      const repository = manager.getRepository(User)
      const actor = await repository.findOneBy({ id: actorId })
      if (actor?.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator access required')
      if (actorId === id && role !== UserRole.ADMIN) throw new ConflictException('不能撤销自己的系统管理权限，请由另一位管理员操作')
      if (!await repository.existsBy({ id })) throw new NotFoundException('用户不存在')
      await repository.update(id, { role })
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
    if (!await this.findById(id)) throw new NotFoundException('用户不存在')
    await this.usersRepository.update(id, { businessRole: scope.role, businessDepartmentId: scope.departmentId, businessEmployeeId: scope.employeeId })
    const updated = await this.findById(id)
    if (!updated) throw new NotFoundException('用户不存在')
    return workbenchAccount(updated)
  }

  async updateFopBinding(id: string, tenantId: string | null, userId: string | null) {
    if (!await this.findById(id)) throw new NotFoundException('用户不存在')
    try {
      await this.usersRepository.update(id, { fopTenantId: tenantId, fopUserId: userId })
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
    const changes: Partial<Pick<User, 'username' | 'avatarUrl'>> = {}
    if (updateData.username !== undefined) changes.username = updateData.username
    if (updateData.avatarUrl !== undefined) changes.avatarUrl = updateData.avatarUrl
    if (Object.keys(changes).length) await this.usersRepository.update(id, changes)
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
