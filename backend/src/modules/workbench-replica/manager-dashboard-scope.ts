import { ForbiddenException } from '@nestjs/common'
import { localDepartments, localEmployeeFilter } from '../fop-data/local-workbench-scope'
import { resolveChartAccess, resolveChartSummaryPolicy, type ChartId } from '../users/chart-permissions'
import type { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import type { User } from '../users/user.entity'
import { collectedAnalyticsScope } from './collected-analytics-scope'

/** Independent grants: own-department records, peer-department aggregates only. */
export function managerDashboardScope(user: User, org: LocalWorkbenchOrganization, query: { departmentId?: string; ownerId?: string }, chartId: ChartId) {
  if (user.role === 'admin' || user.businessRole !== 'department_manager' || !org.analyticsPeers) return undefined
  const access = resolveChartAccess(user).find(p => p.chartId === chartId)
  if (!access?.visible || query.ownerId) throw new ForbiddenException('Manager dashboard scope is not authorized')
  const directory: LocalWorkbenchOrganization = { ...org, ...org.analyticsPeers, employeeIds: null }
  const policy = resolveChartSummaryPolicy(user, chartId)
  const codes: Record<string, string> = { sales1: '业务一部', sales2: '业务二部', sales3: '业务三部', sales4: '业务四部' }
  const own = org.departmentId!
  const detail = access.dataScope === 'none' ? [] : collectedAnalyticsScope(user, org, {}, chartId).employeeIds ?? []
  const permitted = directory.departments.filter(d => org.marketingScope!.departmentIds.includes(d.id)
    && (d.id === own && detail.length > 0 || policy.mode === 'marketing' || policy.mode === 'selected' && policy.departments.some(code => codes[code] === d.name)))
  const permittedIds = new Set(permitted.map(d => d.id))
  const departments = localDepartments(directory).filter(d => permittedIds.has(d.id) || d.id === org.marketingScope!.rootId && permitted.length > 0)
  if (query.departmentId && !departments.some(d => d.id === query.departmentId)) throw new ForbiddenException('Department summary is not authorized')
  const selected = localEmployeeFilter(directory, query).employeeIds ?? []
  const summaryEmployeeIds = directory.members.filter(m => permittedIds.has(m.departmentId) && selected.includes(m.employeeId)).map(m => m.employeeId).sort()
  const employeeIds = detail.filter(id => selected.includes(id))
  return { directory, employeeIds, summaryEmployeeIds, summaryOnly: access.dataScope === 'none' || !!query.departmentId && query.departmentId !== own && query.departmentId !== org.marketingScope!.rootId,
    recordEmployeeIds: localEmployeeFilter(directory, {}).employeeIds ?? [], departments, personalDepartmentId: own,
    defaultDepartmentId: departments.find(d => d.id === org.marketingScope!.rootId)?.id ?? own }
}

/** All subqueries run under one database statement / MVCC snapshot. */
export function combineDashboardStatements(statements: { key: string; sql: string; params: unknown[] }[]) {
  const params: unknown[] = []
  const subqueries = statements.map((statement, index) => {
    const offset = params.length
    params.push(...statement.params)
    return `(${statement.sql.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + offset))}) q${index}`
  })
  return { sql: `SELECT ${statements.map((s, i) => `q${i}.analytics AS "${s.key}"`).join(',')} FROM ${subqueries.join(' CROSS JOIN ')}`, params }
}

export function withDepartmentSummary(detail: any, summary: any, customerOwners: boolean) {
  return { ...detail, rows: [...(detail.rows ?? []).filter((r: any) => !['department', 'person_department'].includes(r.dimension)),
    ...(summary.rows ?? []).filter((r: any) => r.dimension === 'department').map((r: any) => ({ ...r, dimension: customerOwners ? 'person_department' : 'department' }))],
    departmentSummary: summary }
}
