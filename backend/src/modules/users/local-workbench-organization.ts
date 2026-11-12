import type { User } from './user.entity'
import type { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import type { OrganizationNodeEntity } from '../organization/organization-node.entity'
import { ForbiddenException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { effectiveBusinessScope } from './business-scope'

export interface LocalWorkbenchOrganization {
  version: string
  departments: { id: string; name: string; parentId: string | null; pathIds: string[] }[]
  members: { employeeId: string; localEmployeeId: string; departmentId: string; name: string }[]
  employeeIds: string[] | null
  departmentId: string | null
  employeeId: string | null
}
export type LocalOrganizationNode = Pick<OrganizationNodeEntity, 'id' | 'ownerUserId' | 'parentId' | 'name' | 'kind'>
export type LocalOrganizationEmployee = Pick<OrganizationEmployeeEntity, 'id' | 'ownerUserId' | 'departmentId' | 'name' | 'accountId' | 'archivedAt'>
export type LocalOrganizationAccount = Pick<User, 'id' | 'accountDisabled' | 'fopTenantId' | 'fopUserId' | 'fopBindingDetails'>
export interface LocalWorkbenchCompany { tenantId: string; organizationId: string }

export function buildLocalWorkbenchOrganization(user: User, ownerUserId: string, nodes: LocalOrganizationNode[], employees: LocalOrganizationEmployee[], accounts: LocalOrganizationAccount[], company?: LocalWorkbenchCompany): LocalWorkbenchOrganization {
  const deny = (message: string): never => { throw new ForbiddenException({ code: 'local_organization_scope_required', message }) }
  const numeric = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  if (company && (user.role !== 'admin' || typeof company.tenantId !== 'string' || !company.tenantId.trim() || !numeric(company.organizationId))) deny('Invalid trusted company context')
  const tenantId = company?.tenantId ?? user.fopTenantId
  const organizationId = company?.organizationId ?? user.fopBindingDetails?.organizationId
  const scope = effectiveBusinessScope(user)
  if (user.accountDisabled || scope.role === 'none') deny('Local business access is disabled')
  const ordered = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (nodes.some(node => node.ownerUserId !== ownerUserId) || employees.some(employee => employee.ownerUserId !== ownerUserId)) deny('Local organization workspace mismatch')
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length || nodes.length && nodes.filter(node => node.parentId === null && node.kind === 'organization').length !== 1) deny('Invalid local organization root')
  const paths = new Map<string, string[]>()
  for (const node of nodes) {
    const seen = new Set<string>(), path: string[] = []
    let current: LocalOrganizationNode | undefined = node
    while (current) {
      if (seen.has(current.id)) deny('Local organization ancestor cycle')
      seen.add(current.id); path.unshift(current.id)
      if (current.parentId === null) {
        if (current.kind !== 'organization') deny('Invalid local organization root')
        break
      }
      if (current.kind !== 'department') deny('Invalid local organization department')
      current = byId.get(current.parentId)
      if (!current) deny('Local organization parent is missing')
    }
    paths.set(node.id, path)
  }
  if (!nodes.length && (scope.role !== 'admin' || employees.length)) deny('Local organization is missing')
  const accountById = new Map(accounts.map(account => [account.id, account]))
  if (accountById.size !== accounts.length || new Set(employees.map(employee => employee.id)).size !== employees.length) deny('Ambiguous local employee account')
  const linkedAccounts = employees.filter(employee => employee.accountId).map(employee => employee.accountId!)
  if (new Set(linkedAccounts).size !== linkedAccounts.length) deny('Ambiguous local employee account')
  const own = employees.filter(employee => employee.accountId === user.id && !employee.archivedAt)
  if (own.length > 1) deny('Ambiguous local employee account')
  const members: LocalWorkbenchOrganization['members'] = []
  const masterIds = new Set<string>()
  for (const employee of ordered(employees)) {
    if (employee.archivedAt) continue
    if (byId.get(employee.departmentId)?.kind !== 'department') deny('Local employee department is missing')
    const account = employee.accountId ? accountById.get(employee.accountId) : undefined, binding = account?.fopBindingDetails
    if (!account || account.accountDisabled || !account.fopUserId || !tenantId || account.fopTenantId !== tenantId
      || !binding || binding.organizationId !== organizationId || binding.localEmployeeId !== employee.id
      || !numeric(binding.employeeMasterId) || !numeric(binding.employeeRecordId) || !numeric(binding.organizationId)
      || !binding.username?.trim() || !Number.isFinite(Date.parse(binding.verifiedAt))) continue
    if (masterIds.has(binding.employeeMasterId)) deny('Ambiguous FOP business employee mapping')
    masterIds.add(binding.employeeMasterId)
    members.push({ employeeId: binding.employeeMasterId, localEmployeeId: employee.id, departmentId: employee.departmentId, name: employee.name })
  }
  let departmentId: string | null = null, employeeId: string | null = null
  let allowed = nodes.filter(node => node.kind === 'department'), visibleMembers = members
  if (scope.role === 'department_manager') {
    departmentId = scope.departmentId
    if (!departmentId || byId.get(departmentId)?.kind !== 'department') deny('Local manager department is missing')
    allowed = allowed.filter(node => paths.get(node.id)!.includes(departmentId!))
    visibleMembers = members.filter(member => paths.get(member.departmentId)!.includes(departmentId!))
  } else if (scope.role === 'salesperson') {
    const member = own.length === 1 ? members.find(row => row.localEmployeeId === own[0].id) : undefined
    if (!member) deny('Verified local employee binding is required')
    departmentId = member!.departmentId; employeeId = member!.employeeId
    allowed = allowed.filter(node => node.id === departmentId)
    visibleMembers = [member!]
  }
  const marketing = nodes.filter(node => node.name === '营销中心' && node.kind === 'department').map(node => node.id)
  const priority = (id: string) => marketing.some(root => paths.get(id)!.includes(root)) ? 0 : 1
  const departments = ordered(allowed).sort((a, b) => scope.role === 'admin' ? priority(a.id) - priority(b.id) : 0)
    .map(node => ({ id: node.id, name: node.name, parentId: node.parentId, pathIds: paths.get(node.id)! }))
  // Use tuples, not serialization order of JSONB keys. Include invalid/disabled mappings
  // too, so rebinding or restoring a colleague invalidates an in-flight scope.
  const version = createHash('sha256').update(JSON.stringify([
    ownerUserId, user.id, tenantId, company ? null : user.fopUserId, organizationId, scope,
    ordered(nodes).map(node => [node.id, node.parentId, node.name, node.kind]),
    ordered(employees).map(employee => [employee.id, employee.departmentId, employee.name, employee.accountId, employee.archivedAt]),
    ordered(accounts).map(account => { const binding = account.fopBindingDetails; return [account.id, account.accountDisabled, account.fopTenantId, account.fopUserId,
      binding && [binding.employeeNumber, binding.username, binding.name, binding.employeeRecordId, binding.employeeMasterId, binding.organizationId, binding.departmentId, binding.localEmployeeId, binding.localDepartmentId, binding.verifiedAt]] }),
  ])).digest('hex')
  return { version, departments, members: visibleMembers, employeeIds: scope.role === 'admin' ? null : visibleMembers.map(member => member.employeeId).sort(), departmentId, employeeId }
}
