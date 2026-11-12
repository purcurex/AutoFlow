import { readBusinessOwners } from './business-data-access'
import { directoryMembers, directoryPolicy } from '../organization/company-directory'
import { DataSource, FindOperator } from 'typeorm'
import { User } from './user.entity'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'

it('部门经理的客户、报价及沟通读取仅按所属部门匹配，不递归子部门', async () => {
  const query = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([{ id: 'colleague' }]) }
  const actor = { id: 'manager', role: 'user', businessRole: 'department_manager', dataDisplayScope: 'department' as const, businessDepartmentId: 'sales-1', chartPermissions: [], fopTenantId: 'tenant', fopBindingDetails: { organizationId: 'company-1' } }
  const db = { getRepository: () => ({ findOne: async () => actor, createQueryBuilder: () => query }) } as unknown as DataSource
  expect((await readBusinessOwners(db, actor.id)).ids).toEqual(['colleague'])
  expect(query.andWhere).toHaveBeenCalledWith('account.business_department_id = :department', { department: 'sales-1' })
  expect(query.andWhere.mock.calls.some(args => String(args[0]).includes('RECURSIVE'))).toBe(false)
  expect(query.where).toHaveBeenCalledWith('account.fop_tenant_id = :tenant', { tenant: 'tenant' })
  expect(query.andWhere).toHaveBeenCalledWith("account.fop_binding_details ->> 'organizationId' = :organization", { organization: 'company-1' })
})

it('rejects direct local customer analytics before enumerating any accounts for summary-only staff', async () => {
  const member = directoryMembers([['姓名', '账号', '英文名', '职务', '部门'], ['测试', 'staff', 'Staff', '订单管理', '公司/订单管理']])[0]
  const query = jest.fn(() => { throw new Error('Must not enumerate accounts') })
  const db = { getRepository: () => ({ findOne: async () => ({ id: 'u', ...directoryPolicy(member) }), createQueryBuilder: query }) } as unknown as DataSource
  await expect(readBusinessOwners(db, 'u')).rejects.toMatchObject({ status: 403 })
  expect(query).not.toHaveBeenCalled()
})

function workspaceDatabase(extraLinks: object[] = [], ownerLink: string | null = 'company') {
  const actor = { id: 'admin', role: 'admin', businessRole: 'none', organizationWorkspaceOwnerId: ownerLink, chartPermissions: [{ chartId: 'customer_orders', visibility: 'deny', dataScope: 'none' }], fopTenantId: 'tenant' }
  const accounts = [actor, { id: 'company' }, { id: 'bound', fopTenantId: 'tenant', organizationWorkspaceOwnerId: 'company' }, { id: 'unbound', fopTenantId: null }, { id: 'archived', fopTenantId: 'old-tenant' }, { id: 'foreign', fopTenantId: 'tenant', organizationWorkspaceOwnerId: 'other-company' }]
  const members = [{ accountId: 'admin', ownerUserId: 'company', archivedAt: null }, { accountId: 'unbound', ownerUserId: 'company', archivedAt: null }, { accountId: 'archived', ownerUserId: 'company', archivedAt: new Date('2026-01-01') }, { accountId: 'foreign', ownerUserId: 'other-company', archivedAt: null }, ...extraLinks]
  const find = (rows: object[], options: { where: object | object[] }) => {
    const alternatives = Array.isArray(options.where) ? options.where : [options.where]
    return rows.filter(row => alternatives.some(condition => Object.entries(condition).every(([key, want]) => {
      const actual = (row as Record<string, unknown>)[key]
      return want instanceof FindOperator ? want.type === 'in' ? want.value.includes(actual) : want.type === 'isNull' && actual == null : actual === want
    })))
  }
  const tenantQuery = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getRawMany: async () => accounts.filter(account => 'fopTenantId' in account && account.fopTenantId === actor.fopTenantId).map(account => ({ id: account.id })) }
  const users = { findOne: async () => actor, find: jest.fn(async options => find(accounts, options)), createQueryBuilder: () => tenantQuery }
  const employees = { find: jest.fn(async options => find(members, options)) }
  const db = { getRepository: (entity: unknown) => entity === User ? users : entity === OrganizationEmployeeEntity ? employees : undefined } as unknown as DataSource
  return { db, actor, users, members }
}

it('system administrators read bound, unbound and archived local company owners without crossing workspaces', async () => {
  const { db } = workspaceDatabase()
  expect((await readBusinessOwners(db, 'admin')).ids.sort()).toEqual(['admin', 'archived', 'bound', 'company', 'unbound'])
})

it('uses the explicit company workspace when an administrator is not an active employee', async () => {
  const { db, members } = workspaceDatabase()
  members.splice(0, 1)
  expect((await readBusinessOwners(db, 'admin')).ids.sort()).toEqual(['admin', 'archived', 'bound', 'company', 'unbound'])
})

it('limits an administrator without a company assignment to its own workspace', async () => {
  const { db, members } = workspaceDatabase([], null)
  members.splice(0, 1)
  expect((await readBusinessOwners(db, 'admin')).ids).toEqual(['admin'])
})

it.each([{ links: [{ accountId: 'admin', ownerUserId: 'other-company', archivedAt: null }] }, { links: [] }])('rejects ambiguous or conflicting administrator workspace assignments %j', async ({ links }) => {
  const { db, users } = workspaceDatabase(links, 'other-company')
  await expect(readBusinessOwners(db, 'admin')).rejects.toMatchObject({ status: 403 })
  expect(users.find).not.toHaveBeenCalled()
})
