import { ForbiddenException } from '@nestjs/common'
import type { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import type { FopOrderPageQuery } from './fop-data.types'
import { marketingDepartments } from '../users/marketing-departments'

const businessDepartmentNames = ['营销中心', '业务一部', '业务二部', '业务三部', '业务四部'] as const
const businessDepartmentRank = (name: string) => (businessDepartmentNames as readonly string[]).indexOf(name)
const marketingScope = (org: LocalWorkbenchOrganization) => org.marketingScope ?? marketingDepartments(org.departments)

/** Resolve selection before upstream pagination. Neither local IDs nor FOP user identities come from the client. */
export function localEmployeeFilter(org: LocalWorkbenchOrganization, query: { departmentId?: string; ownerId?: string }): NonNullable<FopOrderPageQuery['employeeFilter']> {
  const marketing = marketingScope(org)
  const department = query.departmentId ? localDepartments(org).find(d => d.id === query.departmentId) : undefined
  if (query.departmentId && !department) throw new ForbiddenException('业务部门不在当前账号范围内')
  const members = org.members.filter(m => {
    const path = org.departments.find(d => d.id === m.departmentId)?.pathIds ?? []
    return marketing.departmentIds.includes(m.departmentId)
      && (!department || path.includes(department.id))
      && (org.employeeIds === null || org.employeeIds.includes(m.employeeId))
  })
  if (query.ownerId && !members.some(m => m.employeeId === query.ownerId)) throw new ForbiddenException('业务员不在当前部门或账号范围内')
  const employeeIds = query.ownerId ? [query.ownerId] : members.map(m => m.employeeId)
  if (employeeIds !== null && org.employeeIds !== null && employeeIds.some(id => !org.employeeIds!.includes(id))) throw new ForbiddenException('业务员范围不一致')
  return { employeeIds: employeeIds === null ? null : [...new Set(employeeIds)].sort(), version: org.version }
}

/** Projection follows authorization, without filtering a page or changing upstream totals. */
export function localOwnership<T extends { owner?: { id: string; name: string }; salesperson?: string; department?: { id: string; name: string }; departmentPathIds?: readonly string[]; salesDepartmentCode?: unknown }>(row: T, org: LocalWorkbenchOrganization): T {
  const member = org.members.find(m => m.employeeId === row.owner?.id)
  const department = member && org.departments.find(d => d.id === member.departmentId)
  return { ...row,
    ...(member ? { owner: { id: member.employeeId, name: member.name }, ...('salesperson' in row ? { salesperson: member.name } : {}) } : {}),
    department: department ? { id: department.id, name: department.name } : { id: 'local:unmapped', name: '未关联本地部门' },
    departmentPathIds: department ? [...department.pathIds] : [], salesDepartmentCode: undefined,
  }
}

export function localDepartments(org: LocalWorkbenchOrganization): { id: string; name: string }[] {
  const marketing = marketingScope(org)
  return org.departments.filter(d => d.id === marketing.rootId || marketing.departmentIds.includes(d.id))
    .sort((a, b) => businessDepartmentRank(a.name) - businessDepartmentRank(b.name))
    .map(({ id, name }) => ({ id, name }))
}
export function localSalespeople(org: LocalWorkbenchOrganization, query: { departmentId?: string }): { id: string; name: string }[] {
  const filter = localEmployeeFilter(org, query)
  return org.members.filter(m => filter.employeeIds === null || filter.employeeIds.includes(m.employeeId)).map(m => ({ id: m.employeeId, name: m.name }))
}
