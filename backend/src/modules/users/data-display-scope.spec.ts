import { effectiveBusinessScope, businessScope, matchesBusinessScope } from './business-scope'
import { resolveChartAccess, resolveChartSummaryPolicy } from './chart-permissions'
import { User, UserRole } from './user.entity'
import { WorkbenchAccessService } from './workbench-access.service'
import { UsersService } from './users.service'
import { readBusinessOwners } from './business-data-access'
import type { DataSource, Repository } from 'typeorm'

const manager = () => ({ id: 'manager', role: UserRole.USER, businessRole: 'department_manager', businessDepartmentId: 'sales1', businessEmployeeId: 'employee1', workbenchRoles: ['sales'], chartPermissions: [] } as unknown as User)

describe('manager display scope', () => {
  it('defaults to self and allows explicitly selecting department without changing the manager role', () => {
    const user = manager()
    expect(effectiveBusinessScope(user).role).toBe('salesperson')
    user.dataDisplayScope = 'department'
    expect(effectiveBusinessScope(user)).toEqual(businessScope(user))
    user.dataDisplayScope = 'self'
    expect(businessScope(user).role).toBe('department_manager')
    const scope = effectiveBusinessScope(user)
    expect(matchesBusinessScope(scope, { owner: { id: 'employee1' }, department: { id: 'sales1' } })).toBe(true)
    expect(matchesBusinessScope(scope, { owner: { id: 'employee2' }, department: { id: 'sales1' } })).toBe(false)
  })
  it('does not broaden an unbound personal scope or alter non-manager roles', () => {
    const user = { ...manager(), dataDisplayScope: 'self' as const, businessEmployeeId: null }
    expect(matchesBusinessScope(effectiveBusinessScope(user), { owner: { id: 'any' } })).toBe(false)
    expect(effectiveBusinessScope({ ...user, role: UserRole.ADMIN }).role).toBe('admin')
    expect(effectiveBusinessScope({ ...user, businessRole: 'none' }).role).toBe('none')
  })
  it('limits record charts to self and disables department-only summary charts', () => {
    const user = { ...manager(), dataDisplayScope: 'self' as const }
    expect(resolveChartSummaryPolicy(user, 'registrations').mode).toBe('none')
    expect(resolveChartAccess(user).find(row => row.chartId === 'department_receipts')?.visible).toBe(false)
    expect(resolveChartAccess(user).find(row => row.chartId === 'salesperson_receipts')?.dataScope).toBe('self')
  })
  it('persists only the preference and cannot overwrite manager grants', async () => {
    const user = manager()
    const repository = { findOne: jest.fn(async () => ({ ...user })), update: jest.fn(async (_where, changes) => { Object.assign(user, changes); return { affected: 1 } }) } as unknown as Repository<User>
    const result = await new UsersService(repository).updateProfile(user.id, { dataDisplayScope: 'self' })
    expect(result.dataDisplayScope).toBe('self')
    expect(result.businessRole).toBe('department_manager')
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({ id: user.id, businessRole: 'department_manager' }), { dataDisplayScope: 'self' })
  })
  it.each(['salesperson', 'admin', 'none'] as const)('rejects self-service preference updates from %s', async businessRole => {
    const repository = { findOne: jest.fn(async () => ({ ...manager(), businessRole })), update: jest.fn() } as unknown as Repository<User>
    await expect(new UsersService(repository).updateProfile('manager', { dataDisplayScope: 'self' })).rejects.toMatchObject({ status: 403 })
    expect(repository.update).not.toHaveBeenCalled()
  })
  it('rejects a concurrent manager-role revocation', async () => {
    const repository = { findOne: jest.fn(async () => manager()), update: jest.fn(async () => ({ affected: 0 })) } as unknown as Repository<User>
    await expect(new UsersService(repository).updateProfile('manager', { dataDisplayScope: 'self' })).rejects.toMatchObject({ status: 403 })
  })
})


it('applies the personal preference to local customer/quotation record owners too', async () => {
  const actor = { ...manager(), dataDisplayScope: 'self' }
  const db = { getRepository: () => ({ findOne: async () => actor }) } as unknown as DataSource
  expect(await readBusinessOwners(db, actor.id)).toEqual({ ids: [actor.id], filter: actor.id })
})


it('keeps personal analytics navigation visible for a verified manager with no legacy employee assignment', async () => {
  const actor = { ...manager(), dataDisplayScope: 'self', businessEmployeeId: null,
    fopBindingDetails: { employeeMasterId: '101' } } as User
  const users = { findById: async () => actor, workbenchDepartment: async () => null, defaultProcurementView: async () => 'fulfillment' } as unknown as UsersService
  const access = await new WorkbenchAccessService(users).getAccess(actor.id)
  expect(access.businessRole).toBe('department_manager')
  expect(access.chartVisibility.salesperson_receipts).toBe(true)
  expect(access.chartVisibility.customer_orders).toBe(true)
  expect(access.chartVisibility.department_receipts).toBe(false)
  expect(resolveChartAccess(actor).find(chart => chart.chartId === 'salesperson_receipts')?.dataScope).toBe('self')
})


it.each(['salesperson', 'department_manager'] as const)('initializes a new manager to self but preserves an existing manager choice: %s', async businessRole => {
  const user = { ...manager(), businessRole, dataDisplayScope: 'department' }
  const repository = { findOne: jest.fn(async () => ({ ...user })), update: jest.fn(async (_where, changes) => { Object.assign(user, changes); return { affected: 1 } }) } as unknown as Repository<User>
  await new UsersService(repository).updateBusinessScope(user.id, { role: 'department_manager', departmentId: 'sales1', employeeId: 'employee1' })
  expect(user.dataDisplayScope).toBe(businessRole === 'salesperson' ? 'self' : 'department')
})
