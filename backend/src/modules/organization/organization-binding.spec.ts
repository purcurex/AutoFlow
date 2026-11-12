import { OrganizationService } from './organization.service'
import { OrganizationEmployeeEntity } from './organization-employee.entity'
import { OrganizationNodeEntity } from './organization-node.entity'
import { User } from '../users/user.entity'
import type { VerifiedFopEmployeeBinding } from '../fop-data/fop-employee-binding'

describe('verified account binding keeps local business assignments', () => {
  async function bind(hasEmployee: boolean, existingScope = false) {
    const actor = { id: 'admin', role: 'admin', accountDisabled: false, sessionVersion: 1 }
    const account = { id: 'account', accountDisabled: false, sessionVersion: 2, fopTenantId: null, fopUserId: null,
      businessEmployeeId: existingScope ? 'existing-employee' : null, businessDepartmentId: existingScope ? 'managed-local-department' : null }
    const employee = hasEmployee ? { id: 'local-employee', accountId: 'account', ownerUserId: 'admin', departmentId: 'local-department', archivedAt: null, workbenchRoles: [] } : null
    const users = { findOneBy: async ({ id }: any) => id === 'admin' ? actor : account,
      update: async (_id: string, changes: object) => { Object.assign(account, changes) } }
    const employees = { findOneBy: async ({ accountId }: any) => accountId === 'account' ? employee : null, find: async () => [] }
    const nodes = { existsBy: async () => true, find: async () => [] }
    const manager = { query: async () => [], getRepository: (type: unknown) => {
      if (type === User) return users
      if (type === OrganizationEmployeeEntity) return employees
      if (type === OrganizationNodeEntity) return nodes
      throw new Error('Unexpected repository')
    } }
    const verified: VerifiedFopEmployeeBinding = { tenantId: 'tenant', userId: 'authenticated-user', actorSessionVersion: 1,
      details: { employeeRecordId: '11', employeeMasterId: '111', departmentId: '999', organizationId: '10', name: 'Name', username: 'username',
        localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-11-09T00:00:00Z' } }
    await new OrganizationService({ transaction: async (callback: any) => callback(manager) } as any)
      .setVerifiedFopBinding('admin', 'account', verified, null, 2)
    return account
  }
  it('fills missing assignments with local IDs rather than FOP master and membership department', async () => {
    expect(await bind(true)).toMatchObject({ businessEmployeeId: 'local-employee', businessDepartmentId: 'local-department', fopUserId: 'authenticated-user', sessionVersion: 3 })
  })
  it('leaves independent account assignments empty instead of inventing a local department', async () => {
    expect(await bind(false)).toMatchObject({ businessEmployeeId: null, businessDepartmentId: null })
  })
  it('preserves an explicitly configured manager scope while changing a binding', async () => {
    expect(await bind(true, true)).toMatchObject({ businessEmployeeId: 'existing-employee', businessDepartmentId: 'managed-local-department' })
  })
})
