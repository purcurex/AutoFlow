import { buildLocalWorkbenchOrganization } from './local-workbench-organization'
import { User, UserRole } from './user.entity'
import { UsersService } from './users.service'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import { OrganizationNodeEntity } from '../organization/organization-node.entity'

function fixture() {
  const node = (id: string, parentId: string | null, name = id) => ({ id, parentId, name, ownerUserId: 'workspace', kind: parentId ? 'department' : 'organization' })
  const nodes = [node('root', null), node('marketing', 'root', '营销中心'), node('team', 'marketing'), node('child', 'team'), node('other', 'root')]
  const employee = (id: string, departmentId: string) => ({ id, departmentId, name: id, ownerUserId: 'workspace', accountId: `user-${id}`, archivedAt: null })
  const employees = [employee('a', 'team'), employee('b', 'child'), employee('c', 'other')]
  const account = (id: string, masterId: string) => ({ id: `user-${id}`, accountDisabled: false, fopTenantId: 'tenant', fopUserId: `auth-${id}`, fopBindingDetails: {
    username: id, name: id, employeeRecordId: `1${masterId}`, employeeMasterId: masterId, organizationId: '10', departmentId: '999', localEmployeeId: id, localDepartmentId: 'old-department', verifiedAt: '2026-11-09T00:00:00Z',
  } })
  const accounts = [account('a', '101'), account('b', '102'), account('c', '103')]
  const actor = { ...accounts[0], role: UserRole.USER, businessRole: 'department_manager', dataDisplayScope: 'department' as const, businessDepartmentId: 'team', businessEmployeeId: 'a', organizationWorkspaceOwnerId: null } as User
  const read = (user = actor) => buildLocalWorkbenchOrganization(user, 'workspace', nodes as any, employees as any, accounts as any)
  return { actor, nodes, employees, accounts, read }
}

describe('local workbench organization scope', () => {
  it('maps a local manager subtree to business master IDs without FOP department ancestry', () => {
    const { read } = fixture(), result = read()
    expect(result.employeeIds).toEqual(['101', '102'])
    expect(result.departments.map(row => row.id)).toEqual(['child', 'team'])
    expect(result.members.find(row => row.localEmployeeId === 'b')).toEqual({ employeeId: '102', localEmployeeId: 'b', departmentId: 'child', name: 'b' })
    expect(result.departments.find(row => row.id === 'child')?.pathIds).toEqual(['root', 'marketing', 'team', 'child'])
  })
  it('uses the current local employee department for sales after a move', () => {
    const { actor, employees, read } = fixture()
    actor.businessRole = 'salesperson'; employees[0].departmentId = 'child'
    expect(read()).toMatchObject({ employeeIds: ['101'], departmentId: 'child', employeeId: '101', departments: [{ id: 'child' }] })
  })
  it.each(['admin', 'collaboration'])('keeps %s unrestricted by local mapping while exposing local marketing candidates', role => {
    const { actor, read } = fixture()
    actor.businessRole = 'admin'; actor.role = role === 'admin' ? UserRole.ADMIN : UserRole.USER
    const result = read()
    expect(result.employeeIds).toBeNull()
    expect(result.members).toHaveLength(3)
    expect(result.departments.map(row => row.id)).toEqual(['child', 'marketing', 'team', 'other'])
    expect(result.members.every(member => result.departments.some(department => department.id === member.departmentId))).toBe(true)
  })
  it.each(['tenant', 'organization'])('uses a trusted service company for an unbound system administrator and excludes foreign %s members', foreign => {
    const { actor, nodes, employees, accounts } = fixture()
    const admin = { ...actor, id: 'independent', role: UserRole.ADMIN, fopTenantId: null, fopUserId: null, fopBindingDetails: null } as User
    if (foreign === 'tenant') accounts[2].fopTenantId = 'another'
    else accounts[2].fopBindingDetails.organizationId = '20'
    const result = buildLocalWorkbenchOrganization(admin, 'workspace', nodes as any, employees as any, accounts as any, { tenantId: 'tenant', organizationId: '10' })
    expect(result.employeeIds).toBeNull()
    expect(result.members.map((member: { employeeId: string }) => member.employeeId)).toEqual(['101', '102'])
    expect(admin).toMatchObject({ fopTenantId: null, fopUserId: null, fopBindingDetails: null })
    const other = buildLocalWorkbenchOrganization(admin, 'workspace', nodes as any, employees as any, accounts as any, { tenantId: 'tenant', organizationId: '20' })
    expect(other.version).not.toBe(result.version)
  })
  it('does not let a non-system administrator replace its employee company context', () => {
    const { actor, nodes, employees, accounts } = fixture()
    expect(() => buildLocalWorkbenchOrganization(actor, 'workspace', nodes as any, employees as any, accounts as any, { tenantId: 'tenant', organizationId: '10' })).toThrow()
  })
  it('treats a department with no valid bound members as an empty scope', () => {
    const { accounts, read } = fixture()
    accounts[0].accountDisabled = true; accounts[1].fopTenantId = 'another'
    expect(read().employeeIds).toEqual([])
  })
  it.each(['archived', 'company', 'unverified', 'wrong-local-employee'])('excludes %s member bindings', reason => {
    const { employees, accounts, read } = fixture()
    if (reason === 'archived') employees[1].archivedAt = new Date() as any
    if (reason === 'company') accounts[1].fopBindingDetails.organizationId = '20'
    if (reason === 'unverified') accounts[1].fopBindingDetails = null as any
    if (reason === 'wrong-local-employee') accounts[1].fopBindingDetails.localEmployeeId = 'a'
    expect(read().employeeIds).toEqual(['101'])
  })
  it('rejects ambiguous business master IDs rather than merging local departments', () => {
    const { accounts, read } = fixture()
    accounts[1].fopBindingDetails.employeeMasterId = '101'
    expect(read).toThrow('Ambiguous')
  })
  it.each(['cycle', 'missing-parent', 'multiple-roots', 'foreign-workspace'])('rejects malformed local trees: %s', issue => {
    const { nodes, read } = fixture()
    if (issue === 'cycle') nodes[2].parentId = 'child'
    if (issue === 'missing-parent') nodes[2].parentId = 'missing'
    if (issue === 'multiple-roots') nodes.push({ ...nodes[0], id: 'another-root' })
    if (issue === 'foreign-workspace') nodes[2].ownerUserId = 'foreign'
    expect(read).toThrow()
  })
  it('rejects manager external department IDs and sales without a local binding', () => {
    const { actor, accounts, read } = fixture()
    actor.businessDepartmentId = '999'; expect(read).toThrow()
    actor.businessRole = 'salesperson'; accounts[0].fopBindingDetails = null as any
    expect(read).toThrow()
  })
  it('allows an independent admin without an organization, while denying an unassigned manager', () => {
    const { actor } = fixture()
    expect(buildLocalWorkbenchOrganization({ ...actor, role: UserRole.ADMIN }, 'workspace', [], [], [])).toMatchObject({ employeeIds: null, departments: [], members: [] })
    expect(() => buildLocalWorkbenchOrganization(actor, 'workspace', [], [], [])).toThrow()
  })
  it('hashes the current mappings consistently regardless of query order and invalidates changed binding or ancestry', () => {
    const { nodes, employees, accounts, read } = fixture()
    const version = read().version
    nodes.reverse(); employees.reverse(); accounts.reverse()
    expect(read().version).toBe(version)
    accounts[1].fopBindingDetails.verifiedAt = '2026-11-10T00:00:00Z'
    expect(read().version).not.toBe(version)
    const rebound = read().version
    nodes.find(node => node.id === 'child')!.parentId = 'other'
    expect(read().version).not.toBe(rebound)
  })
})

describe('UsersService local organization reads', () => {
  function setup() {
    const data = fixture()
    const employeeRepository = { find: jest.fn(async ({ where }: any) => where.accountId
      ? data.employees.filter(employee => employee.accountId === where.accountId)
      : data.employees.filter(employee => employee.ownerUserId === where.ownerUserId && !employee.archivedAt)) }
    const nodeRepository = { find: jest.fn(async ({ where }: any) => data.nodes.filter(node => node.ownerUserId === where.ownerUserId)) }
    const repository = { find: jest.fn(async (_query: any) => data.accounts), manager: { getRepository: (entity: unknown) => {
      if (entity === OrganizationEmployeeEntity) return employeeRepository
      if (entity === OrganizationNodeEntity) return nodeRepository
      throw new Error('Unexpected repository')
    } } }
    return { ...data, repository, service: new UsersService(repository as any) }
  }
  it('reads only necessary local mapping fields and returns the current manager subtree', async () => {
    const { service, actor, repository } = setup()
    expect(await service.localWorkbenchOrganization(actor)).toMatchObject({ employeeIds: ['101', '102'], departmentId: 'team' })
    expect(repository.find.mock.calls[0][0].select).toEqual({ id: true, accountDisabled: true, fopTenantId: true, fopUserId: true, fopBindingDetails: true })
  })
  it('rejects a conflicting explicit workspace and never falls back for an archived employee', async () => {
    const { service, actor, employees } = setup()
    await expect(service.localWorkbenchOrganization({ ...actor, organizationWorkspaceOwnerId: 'foreign' })).rejects.toThrow()
    employees[0].archivedAt = new Date() as any
    await expect(service.localWorkbenchOrganization(actor)).rejects.toThrow()
  })
  it('keeps an independent admin with no organization unrestricted and unmapped', async () => {
    const { service, actor } = setup()
    expect(await service.localWorkbenchOrganization({ ...actor, id: 'independent', role: UserRole.ADMIN })).toMatchObject({ employeeIds: null, departments: [], members: [] })
  })
  it('forwards the authenticated service company for an unbound independent administrator', async () => {
    const { service, actor, accounts } = setup()
    accounts[2].fopBindingDetails.organizationId = '20'
    const admin = { ...actor, id: 'independent', role: UserRole.ADMIN, organizationWorkspaceOwnerId: 'workspace', fopTenantId: null, fopUserId: null, fopBindingDetails: null } as User
    const result = await service.localWorkbenchOrganization(admin, { tenantId: 'tenant', organizationId: '10' })
    expect(result.members.map((member: { employeeId: string }) => member.employeeId)).toEqual(['101', '102'])
  })
})


describe('manager personal display preference', () => {
  it('uses only the verified own member and changes the scope version', () => {
    const { actor, read } = fixture()
    const department = read()
    actor.dataDisplayScope = 'self'
    expect(read()).toMatchObject({ employeeIds: ['101'], employeeId: '101', departmentId: 'team' })
    expect(read().version).not.toBe(department.version)
    expect(actor.businessRole).toBe('department_manager')
  })
  it('fails closed for an unbound personal member instead of showing the department', () => {
    const { actor, accounts, read } = fixture()
    actor.dataDisplayScope = 'self'
    accounts[0].fopBindingDetails = null as any
    expect(read).toThrow('Verified local employee binding is required')
  })
})
