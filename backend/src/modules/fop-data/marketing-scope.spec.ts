import { localDepartments, localEmployeeFilter } from './local-workbench-scope'
import { buildReplicaOrganization } from '../workbench-replica/local-workbench-organization'
import type { User } from '../users/user.entity'
import { buildLocalWorkbenchOrganization } from '../users/local-workbench-organization'

const nodes = [
  { id: 'company', parent_id: null, name: 'Company', kind: 'organization' },
  ...[
    ['marketing', 'company', '营销中心'], ['d1', 'marketing', '业务一部'], ['d2', 'marketing', '业务二部'],
    ['d3', 'marketing', '业务三部'], ['d4', 'marketing', '业务四部'],
    ['ops', 'company', '运营中心'], ['outside', 'ops', '业务一部'], ['other', 'marketing', '其他部门'], ['nested', 'd1', '业务子组'],
  ].map(([id, parent_id, name]) => ({ id, parent_id, name, kind: 'department' })),
]
const employees = ['d1', 'd1', 'd2', 'outside', 'other', 'marketing', 'nested'].map((department_id, i) => ({
  id: `person${i}`, account_id: `u${i}`, department_id, name: `Employee${i}`, binding_id: `b${i}`, binding_enabled: true,
  binding_state: 'directory_verified', employee_master_id: `${100 + i}`, person_record_id: `${200 + i}`,
  employee_number: `E${i}`, directory_verified_at: '2026-01-01T00:00:00Z',
}))
const organization = (overrides = {}) => buildReplicaOrganization({ id: 'u0', role: 'admin', ...overrides } as User, 'workspace', nodes, employees, { tenant_id: 'tenant', source_company_id: '100000' })

it('defaults to the four marketing departments, excluding siblings, root staff and same-name outsiders', () => {
  const org = organization()
  expect(localEmployeeFilter(org, {}).employeeIds).toEqual(['100', '101', '102'])
  expect(localEmployeeFilter(org, { departmentId: 'marketing' })).toEqual(localEmployeeFilter(org, {}))
  expect(localDepartments(org).map(d => d.id)).toEqual(['marketing', 'd1', 'd2', 'd3', 'd4'])
  expect(() => localEmployeeFilter(org, { departmentId: 'outside' })).toThrow()
  expect(() => localEmployeeFilter(org, { ownerId: '103' })).toThrow()
  expect(localEmployeeFilter(org, { departmentId: 'd4' }).employeeIds).toEqual([])
})
it('keeps managers and salespeople personal by default; only a manager department preference widens within their department', () => {
  for (const businessRole of ['department_manager', 'salesperson']) {
    const org = organization({ role: 'user', businessRole, businessDepartmentId: 'd1' })
    expect(localEmployeeFilter(org, {}).employeeIds).toEqual(['100'])
    expect(localEmployeeFilter(org, { departmentId: 'd1' }).employeeIds).toEqual(['100'])
    expect(localDepartments(org)).toEqual([{ id: 'd1', name: '业务一部' }])
    expect(() => localEmployeeFilter(org, { departmentId: 'd2' })).toThrow()
  }
  const org = organization({ role: 'user', businessRole: 'department_manager', businessDepartmentId: 'd1', dataDisplayScope: 'department' })
  expect(localEmployeeFilter(org, {}).employeeIds).toEqual(['100', '101'])
  expect(() => localEmployeeFilter(org, { ownerId: '102' })).toThrow()
})
it('never substitutes all-company scope when the marketing root is missing', () => {
  const org = buildReplicaOrganization({ id: 'admin', role: 'admin' } as User, 'workspace', nodes.map(n => n.id === 'marketing' ? { ...n, name: 'Other' } : n), employees, { tenant_id: 'tenant', source_company_id: '100000' })
  expect(localEmployeeFilter(org, {}).employeeIds).toEqual([])
  expect(localDepartments(org)).toEqual([])
})
it('uses the same marketing default for the formal replica directory', () => {
  const localNodes = nodes.map(n => ({ id: n.id, parentId: n.parent_id, name: n.name, kind: n.kind as 'department'|'organization', ownerUserId: 'workspace' }))
  const localEmployees = employees.map(e => ({ id: e.id, accountId: e.account_id, departmentId: e.department_id, name: e.name, ownerUserId: 'workspace', archivedAt: null }))
  const accounts = employees.map(e => ({ id: e.account_id, accountDisabled: false, fopTenantId: 'tenant', fopUserId: e.person_record_id,
    fopBindingDetails: { organizationId: '100000', localEmployeeId: e.id, employeeMasterId: e.employee_master_id, employeeRecordId: e.person_record_id, username: e.name, verifiedAt: '2026-01-01T00:00:00Z' } }))
  const org = buildLocalWorkbenchOrganization({ id: 'admin', role: 'admin' } as User, 'workspace', localNodes, localEmployees, accounts as any, { tenantId: 'tenant', organizationId: '100000' })
  expect(localEmployeeFilter(org, {}).employeeIds).toEqual(['100','101','102'])
  expect(localDepartments(org).map(d => d.id)).toEqual(['marketing','d1','d2','d3','d4'])
})
