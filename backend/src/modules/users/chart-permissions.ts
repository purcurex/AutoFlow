import { isWorkbenchRole } from './workbench-role'
import type { SalesDepartmentCode } from '../fop-data/fop-data.types'
import type { User } from './user.entity'
import { businessScope, effectiveBusinessScope } from './business-scope'

export const CHART_IDS = ['registrations', 'department_receipts', 'salesperson_receipts', 'order_volume', 'customer_orders', 'freight', 'sales_performance'] as const
export type ChartId = typeof CHART_IDS[number]
export interface ChartPermissionOverride {
  chartId: ChartId
  visibility: 'inherit' | 'allow' | 'deny'
  dataScope: 'inherit' | 'none' | 'self' | 'department'
  summaryMode: 'inherit' | 'none' | 'selected' | 'marketing'
  summaryDepartments: SalesDepartmentCode[]
  details: 'inherit' | 'allow' | 'deny'
  export: 'inherit' | 'allow' | 'deny'
}
export interface EffectiveChartAccess {
  chartId: ChartId
  visible: boolean
  dataScope: 'none' | 'self' | 'department' | 'all'
  scopeLabel: string
  canViewDetails: boolean
  canExport: boolean
  summaryOnly: boolean
  summaryDepartments: SalesDepartmentCode[]
}
export type ChartPolicyUser = Pick<User, 'role' | 'businessRole' | 'businessDepartmentId' | 'businessEmployeeId' | 'workbenchRoles'> & { chartPermissions?: ChartPermissionOverride[]; dataDisplayScope?: 'department' | 'self'; fopBindingDetails?: User['fopBindingDetails'] }
export interface ChartSummaryPolicy { mode: 'none' | 'department' | 'selected' | 'marketing'; departments: SalesDepartmentCode[] }

const DEPARTMENTS: SalesDepartmentCode[] = ['sales1', 'sales2', 'sales3', 'sales4']
const SUMMARY_CHARTS: readonly ChartId[] = ['registrations', 'department_receipts', 'order_volume']
const FIELDS = ['chartId', 'visibility', 'dataScope', 'summaryMode', 'summaryDepartments', 'details', 'export']
const isIn = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value)

export function collaborationChartPermissions(): ChartPermissionOverride[] {
  return CHART_IDS.map(chartId => ({
    chartId, visibility: SUMMARY_CHARTS.includes(chartId) ? 'allow' : 'deny', dataScope: 'none',
    summaryMode: SUMMARY_CHARTS.includes(chartId) ? 'marketing' : 'none', summaryDepartments: [], details: 'deny', export: 'deny',
  }))
}

/** Strict at the persistence boundary; corrupt or future policy must not grant access. */
export function validateChartPermissions(value: unknown): value is ChartPermissionOverride[] {
  if (!Array.isArray(value) || value.length > CHART_IDS.length) return false
  const seen = new Set<string>()
  return value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const row = item as Record<string, unknown>
    if (Object.keys(row).length !== FIELDS.length || Object.keys(row).some(key => !FIELDS.includes(key))) return false
    if (!isIn(row.chartId, CHART_IDS) || seen.has(row.chartId as string)) return false
    seen.add(row.chartId as string)
    if (!isIn(row.visibility, ['inherit', 'allow', 'deny']) || !isIn(row.dataScope, ['inherit', 'none', 'self', 'department'])
      || !isIn(row.details, ['inherit', 'allow', 'deny']) || !isIn(row.export, ['inherit', 'allow', 'deny'])
      || !isIn(row.summaryMode, ['inherit', 'none', 'selected', 'marketing'])) return false
    if (!Array.isArray(row.summaryDepartments) || row.summaryDepartments.some(code => !isIn(code, DEPARTMENTS))
      || new Set(row.summaryDepartments).size !== row.summaryDepartments.length) return false
    if (row.summaryMode === 'selected') return SUMMARY_CHARTS.includes(row.chartId as ChartId) && row.summaryDepartments.length > 0
    return row.summaryDepartments.length === 0 && (row.summaryMode !== 'marketing' || SUMMARY_CHARTS.includes(row.chartId as ChartId))
  })
}

/** This expresses local intent only. The FOP summary grant still supplies the
 * authorized department codes and ancestry, independently from record grants. */
export function resolveChartSummaryPolicy(user: ChartPolicyUser, chartId: ChartId): ChartSummaryPolicy {
  const none: ChartSummaryPolicy = { mode: 'none', departments: [] }
  if (user.role === 'admin') return SUMMARY_CHARTS.includes(chartId) ? { mode: 'marketing', departments: [] } : none
  const scope = effectiveBusinessScope(user)
  if (scope.role === 'none' || !SUMMARY_CHARTS.includes(chartId) || !validateChartPermissions(user.chartPermissions ?? [])) return none
  const override = user.chartPermissions?.find(row => row.chartId === chartId)
  if (override?.visibility === 'deny' || override?.summaryMode === 'none') return none
  // 汇总也遵守角色边界：业务员不能借图表授权读取他人汇总，经理不能选择其他部门。
  if (scope.role === 'salesperson') return none
  if (scope.role === 'department_manager') return { mode: scope.departmentId ? 'department' : 'none', departments: [] }
  if (override?.summaryMode === 'selected') return { mode: 'selected', departments: [...override.summaryDepartments] }
  if (override?.summaryMode === 'marketing') return { mode: 'marketing', departments: [] }
  if (scope.role === 'admin') return { mode: 'marketing', departments: [] }
  return none
}

function recordScope(user: ChartPolicyUser, override?: ChartPermissionOverride): EffectiveChartAccess['dataScope'] {
  if (override?.dataScope === 'none') return 'none'
  let scope: EffectiveChartAccess['dataScope'] = 'none'
  const business = effectiveBusinessScope(user)
  const employeeId = user.businessRole === 'department_manager' && user.dataDisplayScope !== 'department'
    ? user.fopBindingDetails?.employeeMasterId ?? business.employeeId : user.businessEmployeeId
  if (business.role === 'admin') scope = 'all'
  else if (business.role === 'department_manager') scope = business.departmentId ? 'department' : 'none'
  else if (business.role === 'salesperson') scope = employeeId ? 'self' : 'none'
  if (scope === 'none') return scope
  if (override?.dataScope === 'self') return employeeId ? 'self' : 'none'
  if (override?.dataScope === 'department' && scope === 'all') return user.businessDepartmentId ? 'department' : 'none'
  return scope
}

export function resolveChartAccess(user: ChartPolicyUser): EffectiveChartAccess[] {
  const isAdmin = user.role === 'admin'
  const validPolicy = isAdmin || validateChartPermissions(user.chartPermissions ?? [])
  const templateEnabled = businessScope(user).role === 'admin' || !!user.workbenchRoles?.includes('sales')
  return CHART_IDS.map(chartId => {
    const override = validPolicy && !isAdmin ? user.chartPermissions?.find(row => row.chartId === chartId) : undefined
    const summary = resolveChartSummaryPolicy(user, chartId)
    const scope = chartId === 'department_receipts' ? 'none' : recordScope(user, override)
    const hasSummary = summary.mode !== 'none'
    const visible = validPolicy && businessScope(user).role !== 'none' && override?.visibility !== 'deny'
      && (override?.visibility === 'allow' || templateEnabled || chartId === 'freight' && user.workbenchRoles?.some(isWorkbenchRole)) && (scope !== 'none' || hasSummary)
    const summaryDepartments = !visible ? [] : summary.mode === 'selected' ? summary.departments
      : summary.mode === 'marketing' ? [...DEPARTMENTS]
        : summary.mode === 'department' && isIn(user.businessDepartmentId, DEPARTMENTS) ? [user.businessDepartmentId as SalesDepartmentCode] : []
    const summaryOnly = visible && scope === 'none' && hasSummary
    return {
      chartId, visible, dataScope: visible ? scope : 'none',
      scopeLabel: !visible ? '暂不可查看' : summaryOnly ? '部门汇总' : scope === 'all' ? '全部业务部门' : scope === 'department' ? '本部门' : '我的业务',
      canViewDetails: visible && scope !== 'none' && chartId !== 'registrations' && override?.details !== 'deny',
      canExport: visible && override?.export !== 'deny', summaryOnly, summaryDepartments,
    }
  })
}
