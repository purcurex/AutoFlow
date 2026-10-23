import type { BusinessScope } from './workbench-access'
export const chartIds = ['registrations', 'department_receipts', 'salesperson_receipts', 'order_volume', 'customer_orders', 'freight', 'sales_performance'] as const
export type ChartId = typeof chartIds[number]
export type SalesDepartmentCode = 'sales1' | 'sales2' | 'sales3' | 'sales4'
export type ChartDecision = 'inherit' | 'allow' | 'deny'
export interface ChartPermissionOverride {
  chartId: ChartId; visibility: ChartDecision; dataScope: 'inherit' | 'self' | 'department'
  summaryMode: 'inherit' | 'none' | 'selected' | 'marketing'; summaryDepartments: SalesDepartmentCode[]
  details: ChartDecision; export: ChartDecision
}
export interface EffectiveChartAccess {
  chartId: ChartId; visible: boolean; dataScope: 'none' | 'self' | 'department' | 'all'; scopeLabel: string
  canViewDetails: boolean; canExport: boolean; summaryOnly: boolean; summaryDepartments: SalesDepartmentCode[]
}
export interface ChartAccessResponse { source: 'mock' | 'fop'; businessScope: BusinessScope; charts: EffectiveChartAccess[] }
export async function getChartAccess(): Promise<ChartAccessResponse> {
  const { default: api } = await import('./index')
  return api.get('/autoflow/integrations/fop/chart-access')
}
