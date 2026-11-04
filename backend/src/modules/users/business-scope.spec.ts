import { businessScope, matchesBusinessScope } from './business-scope'
import { User, UserRole } from './user.entity'
import { readBusinessOwners } from './business-data-access'
import type { DataSource } from 'typeorm'

describe('independent management and business grants', () => {
  it('管理员统一查看全部业务部门，不受历史本人或部门范围配置限制', () => {
    const account = { role: UserRole.ADMIN, businessRole: 'department_manager', businessDepartmentId: 'sales-1', businessEmployeeId: 'employee-1' } as User
    const scope = businessScope(account)
    expect(scope.role).toBe('admin')
    expect(matchesBusinessScope(scope, { department: { id: 'sales-2' } })).toBe(true)
  })

  it('部门经理只看本部门，部门路径不能授权子部门或其他部门', () => {
    const scope = { role: 'department_manager' as const, departmentId: 'sales-1', employeeId: 'employee-1' }
    expect(matchesBusinessScope(scope, { department: { id: 'sales-1' } })).toBe(true)
    expect(matchesBusinessScope(scope, { department: { id: 'child' }, departmentPathIds: ['company', 'sales-1', 'child'] })).toBe(false)
    expect(matchesBusinessScope(scope, { department: { id: 'sales-2' } })).toBe(false)
  })

  it('总经办使用全部部门数据范围，但不因此取得系统管理员身份', () => {
    const account = { role: UserRole.USER, businessRole: 'admin' } as User
    expect(businessScope(account).role).toBe('admin')
    expect(matchesBusinessScope(businessScope(account), { department: { id: 'sales-2' } })).toBe(true)
    expect(account.role).toBe(UserRole.USER)
  })

  it('denies business records for none even if an employee assignment is retained', async () => {
    const account = { id: 'admin', role: UserRole.ADMIN, businessRole: 'none', businessEmployeeId: 'employee-1' } as unknown as User
    expect(matchesBusinessScope(businessScope(account), { owner: { id: 'employee-1' } })).toBe(false)
    const db = { getRepository: () => ({ findOne: async () => account }) } as unknown as DataSource
    await expect(readBusinessOwners(db, 'admin')).rejects.toMatchObject({ status: 403 })
  })
})
