import { ForbiddenException } from '@nestjs/common'
import { localEmployeeFilter } from '../fop-data/local-workbench-scope'
import { resolveChartSummaryPolicy, validateChartPermissions, ChartId } from '../users/chart-permissions'
import type { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import type { User } from '../users/user.entity'

/** Chart policy may narrow the local business scope; it never grants extra records. */
export function collectedAnalyticsScope(user: User, org: LocalWorkbenchOrganization, query: { departmentId?: string; ownerId?: string }, chartId: ChartId = 'order_volume') {
  const filter = localEmployeeFilter(org, query)
  const denied = (): never => { throw new ForbiddenException('Analytics access is not authorized for the selected scope') }
  // Department controls are chart capabilities, not a route to other departments' empty or summary results.
  if (user.role !== 'admin' && ['salesperson', 'department_manager'].includes(user.businessRole)
    && query.departmentId && query.departmentId !== (org.departmentId ?? user.businessDepartmentId)) denied()
  if (chartId === 'freight' && user.role !== 'admin') denied()
  if (user.role !== 'admin' && !validateChartPermissions(user.chartPermissions ?? [])) denied()
  const policy = user.role === 'admin' ? undefined : user.chartPermissions?.find(p => p.chartId === chartId)
  if (policy?.visibility === 'deny') denied()
  const summaryOnly = policy?.dataScope === 'none'
  let employeeIds = filter.employeeIds
  if (summaryOnly) {
    if (query.ownerId) throw new ForbiddenException('Collaboration analytics allows department aggregates only')
    const summary = resolveChartSummaryPolicy(user, chartId)
    const names: Record<string, string> = { sales1: '业务一部', sales2: '业务二部', sales3: '业务三部', sales4: '业务四部' }
    const roots = org.departments.filter(d => summary.mode === 'marketing' ? ['营销中心', ...Object.values(names)].includes(d.name)
      : summary.mode === 'selected' ? summary.departments.some(code => names[code] === d.name)
      : summary.mode === 'department' ? d.id === user.businessDepartmentId : false)
    if (!roots.length) denied()
    const permittedDepartments = org.departments.filter(d => roots.some(root => d.pathIds.includes(root.id)))
    if (query.departmentId && !permittedDepartments.some(d => d.id === query.departmentId)) denied()
    employeeIds = org.members.filter(m => permittedDepartments.some(d => d.id === m.departmentId) && (employeeIds === null || employeeIds.includes(m.employeeId))).map(m => m.employeeId)
  } else if (policy?.dataScope === 'department') {
    if (!user.businessDepartmentId) denied()
    const narrowed = localEmployeeFilter(org, { departmentId: user.businessDepartmentId! })
    employeeIds = (narrowed.employeeIds ?? []).filter(id => employeeIds === null || employeeIds.includes(id))
  } else if (policy?.dataScope === 'self') {
    const id = org.employeeId ?? user.fopBindingDetails?.employeeMasterId
    const member = org.members.find(m => m.employeeId === id && (org.employeeId === id || m.localEmployeeId === user.fopBindingDetails?.localEmployeeId))
    if (!member || employeeIds !== null && !employeeIds.includes(member.employeeId)) denied()
    employeeIds = [member!.employeeId]
  }
  return { employeeIds: employeeIds === null ? null : [...new Set(employeeIds)].sort(), summaryOnly }
}
