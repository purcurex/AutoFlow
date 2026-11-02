import { IsNull, type Repository } from 'typeorm'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import { User, UserRole } from './user.entity'
import { UsersService } from './users.service'
import type { ChartPermissionOverride } from './chart-permissions'

describe('UsersService profile updates', () => {
  it('updates only profile fields even when an unsafe runtime property is supplied', async () => {
    const user = {
      id: 'user-1',
      email: 'sales@autoflow.local',
      username: 'sales',
      avatarUrl: null,
      password: 'hash',
      role: UserRole.USER,
      workbenchRoles: ['sales'],
    } as unknown as User
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
      update: jest.fn(async (_id, changes) => { Object.assign(user, changes) }),
    } as unknown as Repository<User>
    const service = new UsersService(repository)

    const result = await service.updateProfile('user-1', {
      username: 'sales-updated',
      role: UserRole.ADMIN,
      workbenchRoles: ['warehouse'],
    } as never)

    expect(result.username).toBe('sales-updated')
    expect(result.role).toBe(UserRole.USER)
    expect(result.workbenchRoles).toEqual(['sales'])
    expect(result.email).toBe('sales@autoflow.local')
    expect(repository.update).toHaveBeenCalledWith('user-1', { username: 'sales-updated' })
  })

  it.each(['profile', 'avatar'])('preserves a concurrent role revocation during an %s update', async (operation) => {
    const stored = {
      id: 'user-1', username: 'sales', avatarUrl: '/uploads/old.png',
      role: UserRole.ADMIN, workbenchRoles: ['sales'],
    }
    let firstRead = true
    const repository = {
      findOne: jest.fn(async () => {
        const snapshot = { ...stored, workbenchRoles: [...stored.workbenchRoles] }
        if (firstRead) {
          firstRead = false
          // An administrator revokes grants after the profile request read its entity.
          stored.role = UserRole.USER
          stored.workbenchRoles = []
        }
        return snapshot
      }),
      save: jest.fn(async (entity) => { Object.assign(stored, entity); return entity }),
      update: jest.fn(async (_id, changes) => { Object.assign(stored, changes) }),
    } as unknown as Repository<User>
    const service = new UsersService(repository)
    const result = operation === 'profile'
      ? await service.updateProfile('user-1', { username: 'sales-updated' })
      : await service.updateAvatar('user-1', '/uploads/new.png')

    expect(stored.workbenchRoles).toEqual([])
    expect(stored.role).toBe(UserRole.USER)
    expect(result.workbenchRoles).toEqual([])
    expect(result.role).toBe(UserRole.USER)
    expect(repository.update).toHaveBeenCalledWith('user-1', operation === 'profile'
      ? { username: 'sales-updated' }
      : { avatarUrl: '/uploads/new.png' })
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('UsersService workbench persistence', () => {
  it('updates only business roles so simultaneous account identity changes cannot be overwritten', async () => {
    const stored = { id: 'user-1', username: 'current', role: UserRole.ADMIN, workbenchRoles: ['sales'] }
    const repository = {
      findOne: jest.fn().mockResolvedValue({ ...stored }),
      update: jest.fn(async (_id, changes) => { Object.assign(stored, changes) }),
      save: jest.fn(async (user) => user),
    } as unknown as Repository<User>
    const result = await new UsersService(repository).updateWorkbenchRoles('user-1', ['warehouse'])
    expect(repository.update).toHaveBeenCalledWith('user-1', { workbenchRoles: ['warehouse'] })
    expect(stored.role).toBe(UserRole.ADMIN)
    expect(result).not.toHaveProperty('password')
  })

  it('emits escaped literal search predicates and bounded pagination without selecting credentials', async () => {
    const repository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) } as unknown as Repository<User>
    await new UsersService(repository).listWorkbenchAccounts({ page: 2, pageSize: 10, search: 'sales_%' })
    const options = (repository.findAndCount as jest.Mock).mock.calls[0][0]
    expect(options.skip).toBe(10)
    expect(options.take).toBe(10)
    expect(options.where).toHaveLength(3)
    expect(options.where[0].username.value).toBe('%sales\\_\\%%')
    expect(options.select).not.toHaveProperty('password')
  })
})

describe('UsersService chart permission persistence', () => {
  const chartPermissions: ChartPermissionOverride[] = [{ chartId: 'customer_orders', visibility: 'deny', dataScope: 'inherit', summaryMode: 'inherit', summaryDepartments: [], details: 'inherit', export: 'inherit' }]
  const setup = (admin = true, revokeBeforeLock = false) => {
    const actor = { id: 'admin', role: admin ? UserRole.ADMIN : UserRole.USER }
    const target = { id: 'sales', username: 'sales', role: UserRole.USER, businessRole: 'salesperson', businessEmployeeId: 'employee-a', businessDepartmentId: 'sales1', workbenchRoles: ['sales'], fopTenantId: 'tenant', fopUserId: 'fop-a', chartPermissions: [], password: 'secret' }
    let locked = false
    const repository = {
      findOne: async ({ where }: any) => {
        if (!locked) throw new Error('Account read outside authorization transaction')
        return where.id === actor.id ? { ...actor } : where.id === target.id ? { ...target } : null
      },
      update: async (id: string, changes: object) => {
        if (!locked || id !== target.id) throw new Error('Invalid mutation')
        Object.assign(target, changes)
      },
      manager: { transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
        query: async () => { locked = true; if (revokeBeforeLock) actor.role = UserRole.USER },
        getRepository: () => repository,
      }) },
    } as unknown as Repository<User>
    return { service: new UsersService(repository), target }
  }

  it('persists only chart overrides and returns the complete safe account after authorization', async () => {
    const { service, target } = setup()
    const result = await service.updateChartPermissions('admin', 'sales', chartPermissions)
    expect(result).toMatchObject({ id: 'sales', chartPermissions, role: 'user', businessScope: { role: 'salesperson', employeeId: 'employee-a' }, fopBinding: { tenantId: 'tenant', userId: 'fop-a' } })
    expect(target).toMatchObject({ workbenchRoles: ['sales'], businessRole: 'salesperson', businessEmployeeId: 'employee-a', fopTenantId: 'tenant', fopUserId: 'fop-a' })
    expect(result).not.toHaveProperty('password')
    chartPermissions[0].summaryDepartments.push('sales1')
    expect(target.chartPermissions).not.toEqual(chartPermissions)
    chartPermissions[0].summaryDepartments.pop()
  })

  it.each([[false, false], [true, true]])('rejects nonadministrators and demotion at transaction entry (%s, %s)', async (admin, revoke) => {
    const { service, target } = setup(admin, revoke)
    await expect(service.updateChartPermissions('admin', 'sales', chartPermissions)).rejects.toMatchObject({ status: 403 })
    expect(target.chartPermissions).toEqual([])
  })

  it('rejects duplicate chart IDs before persistence and missing targets after authorization', async () => {
    const { service, target } = setup()
    await expect(service.updateChartPermissions('admin', 'sales', [...chartPermissions, ...chartPermissions])).rejects.toMatchObject({ status: 400 })
    await expect(service.updateChartPermissions('admin', 'missing', chartPermissions)).rejects.toMatchObject({ status: 404 })
    expect(target.chartPermissions).toEqual([])
  })

  it('returns persisted policy with account listings and defaults legacy accounts to inheritance', async () => {
    const repository = { findAndCount: jest.fn().mockResolvedValue([[{ id: 'a', chartPermissions }, { id: 'b' }], 2]), manager: { getRepository: () => ({ find: async () => [] }) } } as unknown as Repository<User>
    const result = await new UsersService(repository).listWorkbenchAccounts({ page: 1, pageSize: 20 })
    expect(result.items[0].chartPermissions).toEqual(chartPermissions)
    expect(result.items[1].chartPermissions).toEqual([])
    expect((repository.findAndCount as jest.Mock).mock.calls[0][0].select.chartPermissions).toBe(true)
  })
})


describe('Procurement defaults from current employee job and organization', () => {
  function setup(businessRole = 'admin', departmentName = '采购管理', jobTitle = '', parentName = '供应链中心') {
    const employee = { id: 'employee', ownerUserId: 'directory', departmentId: 'department', jobTitle }
    const employees = { find: jest.fn().mockResolvedValue([employee]) }
    const nodes = { find: jest.fn().mockResolvedValue([
      { id: 'department', parentId: 'parent', name: departmentName },
      { id: 'parent', parentId: null, name: parentName },
    ]) }
    const repository = { manager: { getRepository: (entity: unknown) => entity === OrganizationEmployeeEntity ? employees : nodes } } as unknown as Repository<User>
    const user = { id: 'account', role: UserRole.USER, businessRole, workbenchRoles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'] } as User
    return { service: new UsersService(repository), user, employees, nodes }
  }
  it.each(['salesperson', 'department_manager', 'none'])('keeps %s on fulfillment despite all five grants', async role => {
    const { service, user } = setup(role)
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
  })
  it('uses current procurement department and ignores entry grants', async () => {
    const { service, user, employees, nodes } = setup()
    expect(await service.defaultProcurementView(user)).toBe('purchase')
    expect(employees.find).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account', archivedAt: IsNull() }, take: 2 }))
    expect(nodes.find).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'directory' } }))
    nodes.find.mockResolvedValue([{ id: 'department', parentId: null, name: '信息管理部' }])
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
  })
  it('recognizes procurement jobs but prioritizes Marketing Center ancestry', async () => {
    const { service, user, nodes } = setup('admin', '运营部', '采购专员')
    expect(await service.defaultProcurementView(user)).toBe('purchase')
    nodes.find.mockResolvedValue([{ id: 'department', parentId: 'marketing', name: '业务一部' }, { id: 'marketing', parentId: null, name: '营销中心' }])
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
  })
  it('uses fulfillment for administrators, missing or ambiguous employee bindings', async () => {
    const { service, user, employees } = setup()
    expect(await service.defaultProcurementView({ ...user, role: UserRole.ADMIN })).toBe('fulfillment')
    employees.find.mockResolvedValue([])
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
    employees.find.mockResolvedValue([{}, {}])
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
  })
  it('stops traversing malformed organization cycles', async () => {
    const { service, user, nodes } = setup()
    nodes.find.mockResolvedValue([{ id: 'department', parentId: 'department', name: '运营部' }])
    expect(await service.defaultProcurementView(user)).toBe('fulfillment')
  })
})


describe('Workbench department display follows business scope', () => {
  function setup() {
    const employees = { find: jest.fn().mockResolvedValue([{ ownerUserId: 'company' }]) }
    const nodes = { find: jest.fn().mockResolvedValue([{ id: 'd1', name: '业务一部' }, { id: 'd2', name: '业务二部' }]) }
    const repository = { manager: { getRepository: (entity: unknown) => entity === OrganizationEmployeeEntity ? employees : nodes } } as unknown as Repository<User>
    const user = { id: 'employee-account', role: UserRole.USER, businessRole: 'salesperson', businessDepartmentId: 'd1' } as User
    return { service: new UsersService(repository), user, employees, nodes }
  }
  it.each(['salesperson', 'department_manager'] as const)('resolves the %s scope even without order data', async businessRole => {
    const { service, user, nodes } = setup()
    expect(await service.workbenchDepartment({ ...user, businessRole })).toEqual({ id: 'd1', name: '业务一部' })
    expect(nodes.find).toHaveBeenCalledWith({ where: { ownerUserId: 'company' }, select: { id: true, name: true } })
    expect(await service.workbenchDepartment({ ...user, role: UserRole.ADMIN, businessDepartmentId: 'd2' })).toEqual({ id: 'd2', name: '业务二部' })
  })
  it.each([UserRole.ADMIN, UserRole.USER])('uses company-wide display for business admins with system role %s', async role => {
    const { service, user, employees } = setup()
    expect(await service.workbenchDepartment({ ...user, role, businessRole: 'admin' })).toBeNull()
    expect(employees.find).not.toHaveBeenCalled()
  })
  it('never assigns a local department name to an external scope ID', async () => {
    const { service, user } = setup()
    expect(await service.workbenchDepartment({ ...user, businessDepartmentId: 'FOP-DEPT-1' })).toEqual({ id: 'FOP-DEPT-1', name: null })
  })
  it('handles absent and ambiguous employee bindings without choosing another workspace', async () => {
    const { service, user, employees, nodes } = setup()
    employees.find.mockResolvedValue([{ ownerUserId: 'other' }, { ownerUserId: 'company' }])
    expect(await service.workbenchDepartment(user)).toEqual({ id: 'd1', name: null })
    expect(nodes.find).not.toHaveBeenCalled()
    employees.find.mockResolvedValue([])
    expect(await service.workbenchDepartment({ ...user, organizationWorkspaceOwnerId: 'company' })).toEqual({ id: 'd1', name: '业务一部' })
    expect(await service.workbenchDepartment({ ...user, businessRole: 'none' })).toBeNull()
    expect(await service.workbenchDepartment({ ...user, businessDepartmentId: null })).toBeNull()
  })
})
