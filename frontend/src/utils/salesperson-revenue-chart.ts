import type { EChartsCoreOption } from 'echarts/core'
import type { AnalyticsRow,TrendTarget } from '@/api/local-dashboard-analytics'
import { formatChartCurrency, formatKnownCurrency } from './currency'

type Column = { kind: 'department' | 'person'; label: string; departmentName: string; rows: AnalyticsRow[] } | null
const departmentOrder = ['业务一部', '业务二部', '业务三部', '业务四部']
export function compareBusinessDepartments(a: string, b: string) {
  const rank = (name: string) => { const index = departmentOrder.indexOf(name); return index < 0 ? 99 : index }
  return rank(a) - rank(b) || a.localeCompare(b, 'zh-CN')
}
const usd = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? formatChartCurrency(value) : '—'

/** Customer-owner departments can differ from order-owner departments. Use the matching backend subtotal. */
export function salespersonRows(rows: AnalyticsRow[]): AnalyticsRow[] {
  const dimension = rows.some(row => row.dimension === 'person_department') ? 'person_department' : 'department'
  return rows.filter(row => row.dimension === 'person' || row.dimension === dimension)
    .map(row => row.dimension === 'person_department' ? { ...row, dimension: 'department' } : row)
}

export type SalespersonMetric = 'amount' | 'registrations' | 'orders' | 'quantity'
/** Shared person view: layout only; values and matching subtotals come from scoped backend aggregates. */
export function salespersonGroupedChart(input: AnalyticsRow[], metric: SalespersonMetric, labels: {amount?:string;count?:string;extraTooltip?:(row:AnalyticsRow)=>string} = {}): { option: EChartsCoreOption; minWidth: number; targets: (TrendTarget|null)[] } {
  const rows = salespersonRows(input), registration = metric === 'registrations', monetary = metric === 'amount'
  const amountLabel=labels.amount??'订单金额',countLabel=labels.count??'订单量'
  const metricLabel = registration ? '注册客户数' : metric === 'orders' ? '订单数' : '商品件数'
  const valueOf = (row: AnalyticsRow | undefined) => !row ? null : registration ? row.registrationCount ?? row.orderCount : monetary ? row.amount : metric === 'quantity' ? row.quantity : row.orderCount
  const departments = rows.filter(row => row.dimension === 'department')
  const people = rows.filter(row => row.dimension === 'person')
  const currencies = [...new Set(departments.map(row => row.currency).filter((value): value is string => !!value))].sort()
  const rankingCurrency = currencies.includes('USD') ? 'USD' : currencies[0]
  const departmentIds = [...new Set(departments.map(row => row.id))].sort((a, b) => {
    const name = (id: string) => departments.find(row => row.id === id)!.label
    return compareBusinessDepartments(name(a), name(b)) || a.localeCompare(b)
  })
  const columns: Column[] = []
  for (const id of departmentIds) {
    const totals = departments.filter(row => row.id === id), departmentName = totals[0]!.label
    if (columns.length) columns.push(null)
    columns.push({ kind: 'department', label: departmentName, departmentName, rows: totals })
    const members = people.filter(row => (row.departmentId ?? 'unknown') === id)
    const personIds = [...new Set(members.map(row => row.id))].sort((a, b) => {
      const amount = (personId: string) => {
        const row = members.find(row => row.id === personId && (!monetary || row.currency === rankingCurrency))
        return Number(valueOf(row) ?? -Infinity)
      }
      return amount(b) - amount(a) || a.localeCompare(b)
    })
    for (const personId of personIds) {
      const personal = members.filter(row => row.id === personId)
      columns.push({ kind: 'person', label: personal[0]!.englishName?.trim() || (personId === 'unknown' ? '未绑定业务员' : '—'), departmentName, rows: personal })
    }
  }
  const usdOnly = monetary && currencies.length === 1 && currencies[0] === 'USD'
  const option: EChartsCoreOption = {
    tooltip: { trigger: 'axis', renderMode: 'richText', ...(usdOnly ? { valueFormatter: usd } : {}), formatter: (raw: unknown) => {
      const points = (Array.isArray(raw) ? raw : [raw]) as { dataIndex?: number; seriesIndex: number; value: number | null }[]
      const column = points[0]?.dataIndex === undefined ? null : columns[points[0].dataIndex]
      if (!column) return ''
      const name = !registration && !monetary ? column.rows[0]?.label : column.label === '—' ? '未设置英文名' : column.label
      return [column.departmentName, column.kind === 'department' ? '部门汇总' : `业务员：${name}`,
        ...points.map(point => {
          const row = column.rows.find(row => !monetary || row.currency === currencies[point.seriesIndex])
          if (monetary) return `${amountLabel}${currencies.length > 1 ? `（${currencies[point.seriesIndex]}）` : ''}：${formatKnownCurrency(point.value, currencies[point.seriesIndex])}\n${countLabel}：${row?.orderCount?.toLocaleString('zh-CN') ?? '—'} 笔${row&&labels.extraTooltip?`\n${labels.extraTooltip(row)}`:''}`
          const count = `${metricLabel}：${point.value == null ? '—' : point.value.toLocaleString('zh-CN')}`
          return metric === 'quantity' ? `订单数：${row?.orderCount?.toLocaleString('zh-CN') ?? '—'}\n${count}` : count
        })].join('\n')
    } },
    legend: { show: monetary && currencies.length > 1 },
    grid: { left: 16, right: 24, top: 34, bottom: 22, containLabel: true },
    xAxis: { type: 'category', data: columns.map(column => column?.label ?? ''), axisTick: { show: false }, axisLabel: { interval: 0, rotate: 0, lineHeight: 18, fontSize: 12 } },
    yAxis: { type: 'value', name: !monetary ? metricLabel : `${amountLabel}（${usdOnly?'美元':'原币'}）`, ...(!monetary ? { minInterval: 1 } : {}), ...(usdOnly ? { axisLabel: { formatter: usd } } : {}) },
    series: (monetary ? currencies : [metric]).map(code => ({ name: !monetary ? metricLabel : currencies.length === 1 ? amountLabel : `${amountLabel}（${code}）`, type: 'bar', barMaxWidth: 32,
      ...(monetary && code === 'USD' ? { tooltip: { valueFormatter: usd } } : {}),
      data: columns.map(column => {
        const row = column?.rows.find(row => !monetary || row.currency === code)
        const value = valueOf(row)
        return !column || value == null ? null : { value: Number(value), itemStyle: { color: column.kind === 'department' ? '#5368be' : '#37a3a3', borderRadius: [4, 4, 0, 0] } }
      }),
    })),
  }
  // Preserve readable English labels and all members; narrow views scroll rather than drop people.
  return { option, targets:columns.map(c=>c&&c.rows[0]&&c.rows[0].id!=='unknown'?{dimension:c.kind,id:c.rows[0].id,name:c.label}:null), minWidth: columns.reduce((width, column) => width + Math.max(64, (column?.label.length ?? 0) * 8 + 16), 90) }
}
