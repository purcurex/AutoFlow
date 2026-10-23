import type { ChartAccessResponse, EffectiveChartAccess } from '@/api/fop-chart-access'
const chartIds = ['registrations', 'department_receipts', 'salesperson_receipts', 'order_volume', 'customer_orders', 'freight', 'sales_performance'] as const
export function chartAccessFixture(): ChartAccessResponse {
  return { source: 'mock', businessScope: { role: 'admin', departmentId: null, employeeId: 'self' }, charts: chartIds.map(chartId => ({ chartId, visible: true, dataScope: 'all', scopeLabel: '获授权数据', canViewDetails: chartId !== 'department_receipts', canExport: true, summaryOnly: chartId === 'department_receipts', summaryDepartments: [] } satisfies EffectiveChartAccess)) }
}
