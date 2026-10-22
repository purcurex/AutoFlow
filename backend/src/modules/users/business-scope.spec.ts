import { businessScope, matchesBusinessScope } from './business-scope'
import { User, UserRole } from './user.entity'
import { readBusinessOwners } from './business-data-access'
import type { DataSource } from 'typeorm'

describe('independent management and business grants', () => {
  it('does not expand a system administrator beyond their assigned business scope', () => {
    const account = { role: UserRole.ADMIN, businessRole: 'department_manager', businessDepartmentId: 'sales-1', businessEmployeeId: 'employee-1' } as User
    const scope = businessScope(account)
    expect(scope.role).toBe('department_manager')
    expect(matchesBusinessScope(scope, { department: { id: 'sales-2' } })).toBe(false)
  })

  it('denies business records for none even if an employee assignment is retained', async () => {
    const account = { id: 'admin', role: UserRole.ADMIN, businessRole: 'none', businessEmployeeId: 'employee-1' } as unknown as User
    expect(matchesBusinessScope(businessScope(account), { owner: { id: 'employee-1' } })).toBe(false)
    const db = { getRepository: () => ({ findOne: async () => account }) } as unknown as DataSource
    await expect(readBusinessOwners(db, 'admin')).rejects.toMatchObject({ status: 403 })
  })
})
