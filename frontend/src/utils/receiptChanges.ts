import type { ReceiptSeries } from '@/api/fop-dashboard'
import { formatChartCurrency } from './currency'
import { sumMoney } from './tableTotals'

export interface ReceiptChange { delta: number | null; previous: number | null; percent: number | null }
function change(current: number | null | undefined, previous: number | null | undefined): ReceiptChange {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return { delta: null, previous: null, percent: null }
  const delta = sumMoney([current, -previous])
  return { delta, previous, percent: previous === 0 ? (delta === 0 ? 0 : null) : delta / Math.abs(previous) * 100 }
}
export function receiptChanges(series: ReceiptSeries, months: string[], baselineMonth?: string): ReceiptChange[] {
  const values = new Map(months.map((month, index) => [month, series.amounts[index]]))
  return months.map((month, index) => {
    const [year, number] = month.split('-').map(Number)
    const previousMonth = new Date(Date.UTC(year!, number! - 2, 1)).toISOString().slice(0, 7)
    const previous = values.has(previousMonth) ? values.get(previousMonth) : previousMonth === baselineMonth ? series.previousAmount : null
    return change(series.amounts[index], previous)
  })
}
export function totalReceiptChange(changes: ReceiptChange[]): ReceiptChange {
  const comparable = changes.filter(item => item.delta !== null && item.previous !== null)
  if (!comparable.length) return change(null, null)
  const previous = sumMoney(comparable.map(item => item.previous!))
  return change(sumMoney([previous, ...comparable.map(item => item.delta!)]), previous)
}
export function formatReceiptChange(value: ReceiptChange | undefined, locale = 'zh-CN') {
  const zh = locale.startsWith('zh'), delta = value?.delta
  const amount = delta == null ? '—' : `${delta > 0 ? '+' : ''}${formatChartCurrency(delta, locale)}`
  const percent = delta == null ? (zh ? '无上月数据' : 'No prior month data')
    : value?.percent == null ? (zh ? '—（上月为0）' : '— (prior month: 0)')
      : new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.percent / 100)
  return { amount, percent, direction: delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down' }
}
