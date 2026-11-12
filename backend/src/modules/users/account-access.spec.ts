import { Repository } from 'typeorm'
import { User, UserRole } from './user.entity'
import { UsersService } from './users.service'
import { accountRole } from './account-role'
import { collaborationChartPermissions, resolveChartAccess } from './chart-permissions'
import { UpdateAccountAccessDto } from './dto/account-access.dto'
import { WORKBENCH_ROLES } from './workbench-role'

const input = (role: UpdateAccountAccessDto['accountRole']): UpdateAccountAccessDto => ({ accountRole: role, businessScope: { role: role === 'administrator' || role === 'collaboration' ? 'admin' : role, departmentId: 'd1', employeeId: 'e1' }, workbenchRoles: [...WORKBENCH_ROLES] })
function setup() {
  const actor = { id: 'admin', role: UserRole.ADMIN }
  const target = { id: 'target', role: UserRole.USER, businessRole: 'salesperson', businessDepartmentId: 'd1', businessEmployeeId: 'e1', chartPermissions: [], workbenchRoles: ['sales'], password: 'private', fopTenantId: 'tenant', fopUserId: 'fop-user' } as unknown as User
  let locked = false
  const repository = {
    findOne: jest.fn(async ({ where }: any) => { if (!locked) throw Error('Read outside lock'); return where.id === actor.id ? actor : where.id === target.id ? target : null }),
    findOneBy: jest.fn(async ({ id }: { id: string }) => { if (!locked) throw Error('Read outside lock'); return id === actor.id ? actor : id === target.id ? target : null }),
    existsBy: jest.fn(async ({ id }: { id: string }) => id === actor.id || id === target.id),
    update: jest.fn(async (_id, changes) => { Object.assign(target, changes) }),
    manager: { transaction: async (callback: (manager: any) => Promise<unknown>) => callback({ query: async () => { locked = true }, getRepository: () => repository }) },
  }
  return { actor, target, repository, service: new UsersService(repository as unknown as Repository<User>) }
}
it.each(['administrator', 'department_manager', 'salesperson', 'collaboration'] as const)('atomically applies %s without touching credentials or FOP identity', async role => {
  const { service, repository, target } = setup()
  const result = await service.updateAccountAccess('admin', 'target', input(role))
  expect(repository.update).toHaveBeenCalledTimes(1)
  expect(accountRole(target)).toBe(role)
  expect(result).toMatchObject({ accountRole: role, workbenchRoles: [...WORKBENCH_ROLES], fopBinding: { tenantId: 'tenant', userId: 'fop-user' } })
  expect(target.password).toBe('private'); expect(result).not.toHaveProperty('password')
  expect(repository.update.mock.calls[0][1]).not.toHaveProperty('fopUserId')
})
it('applies the existing collaboration summary-only chart policy on role changes', async () => {
  const { service, target } = setup()
  await service.updateAccountAccess('admin', 'target', input('collaboration'))
  expect(target.role).toBe(UserRole.USER)
  expect(target.chartPermissions).toEqual(collaborationChartPermissions())
  const charts = resolveChartAccess(target)
  expect(charts.filter(chart => chart.visible).map(chart => chart.chartId)).toEqual(['registrations', 'department_receipts', 'order_volume'])
  expect(charts.every(chart => !chart.canViewDetails && chart.dataScope === 'none')).toBe(true)
})
it('canonicalizes administrator assignment even when an older client submits closed business and no workbenches', async () => {
  const { service, target } = setup()
  target.role = UserRole.ADMIN; target.businessRole = 'none'; target.chartPermissions = collaborationChartPermissions()
  const result = await service.updateAccountAccess('admin', 'target', { ...input('administrator'), businessScope: { role: 'none', departmentId: 'd1', employeeId: 'e1' }, workbenchRoles: [] })
  expect(result.businessScope).toEqual({ role: 'admin', departmentId: null, employeeId: null })
  expect(target.role).toBe(UserRole.ADMIN)
  expect(target.businessRole).toBe('admin')
  expect(target.workbenchRoles).toEqual(['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'])
  expect(target).toMatchObject({ businessDepartmentId: 'd1', businessEmployeeId: 'e1', fopTenantId: 'tenant', fopUserId: 'fop-user' })
})
it('promotes through the legacy management endpoint and closes business scope on a role-only demotion', async () => {
  const { service, target } = setup()
  await service.updateManagementRole('admin', 'target', UserRole.ADMIN)
  expect(target).toMatchObject({ role: 'admin', businessRole: 'admin', workbenchRoles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], businessDepartmentId: 'd1', businessEmployeeId: 'e1', fopUserId: 'fop-user' })
  await service.updateManagementRole('admin', 'target', UserRole.USER)
  expect(target).toMatchObject({ role: 'user', businessRole: 'none', workbenchRoles: [], businessDepartmentId: 'd1', businessEmployeeId: 'e1', fopUserId: 'fop-user' })
  expect(resolveChartAccess(target).every(chart => !chart.visible)).toBe(true)
})
it('demotes an administrator to the selected employee scope and restores ordinary chart restrictions', async () => {
  const { service, target } = setup()
  await service.updateAccountAccess('admin', 'target', input('administrator'))
  const result = await service.updateAccountAccess('admin', 'target', input('salesperson'))
  expect(result.businessScope).toEqual({ role: 'salesperson', departmentId: 'd1', employeeId: 'e1' })
  expect(target.role).toBe(UserRole.USER)
  expect(resolveChartAccess(target).find(chart => chart.chartId === 'customer_orders')?.dataScope).toBe('self')
})
it('rejects nonadmins, self-demotion, missing targets and inconsistent role/scope', async () => {
  const { service, actor, repository } = setup()
  actor.role = UserRole.USER
  await expect(service.updateAccountAccess('admin', 'target', input('administrator'))).rejects.toMatchObject({ status: 403 })
  actor.role = UserRole.ADMIN
  await expect(service.updateAccountAccess('admin', 'admin', input('collaboration'))).rejects.toMatchObject({ status: 409 })
  await expect(service.updateAccountAccess('admin', 'missing', input('collaboration'))).rejects.toMatchObject({ status: 404 })
  await expect(service.updateAccountAccess('admin', 'target', { ...input('collaboration'), businessScope: { role: 'salesperson', departmentId: 'd1', employeeId: 'e1' } })).rejects.toMatchObject({ status: 400 })
  expect(repository.update).not.toHaveBeenCalled()
})
it('narrows every search predicate with the requested role before pagination', async () => {
  const repository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) }
  const service = new UsersService(repository as unknown as Repository<User>)
  await service.listWorkbenchAccounts({ accountRole: 'collaboration', search: 'alex', page: 2, pageSize: 20 })
  const query = repository.findAndCount.mock.calls[0][0]
  expect(query).toMatchObject({ skip: 20, take: 20 })
  expect(query.where).toHaveLength(3)
  for (const predicate of query.where) { expect(predicate.role).toBe('user'); expect(predicate.businessRole.value).toEqual(['admin', 'none']) }
})
