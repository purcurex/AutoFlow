import type { EChartsCoreOption } from 'echarts/core'
import type { FreightCarrier, FreightData, FreightQuery, FreightSeries, FreightValue } from '@/api/fop-freight'
import type { WorkbenchRole } from './workbench'
import { formatChartCurrency } from './currency'

export const freightCarriers: readonly FreightCarrier[] = ['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER']
const names = { YT: ['云途YT', 'YunExpress YT'], '4PX': ['4PX', '4PX'], WB: ['万邦WB', 'Wanb WB'], YW: ['燕文YW', 'Yanwen YW'], JS: ['极速JS', 'Jisu JS'], OTHER: ['其他', 'Other'] }
const colors = ['#94A5DD', '#74B9AB', '#8CB8D1', '#B39FCB', '#D1B480', '#91B6A0', '#ABB4C2']
export const freightCarrierName = (code: FreightCarrier, locale = 'zh-CN') => names[code][locale.startsWith('zh') ? 0 : 1]!
export function freightSeries(data: FreightData): FreightSeries[] {
  return [...data.series].sort((a, b) => (a.kind === 'total' ? -1 : freightCarriers.indexOf(a.carrierCode!)) - (b.kind === 'total' ? -1 : freightCarriers.indexOf(b.carrierCode!)))
}
export function freightChange(value: FreightValue, locale = 'zh-CN') {
  return { amount: `${value.delta > 0 ? '+' : ''}${formatChartCurrency(value.delta, locale)}`,
    percent: value.percent === null ? locale.startsWith('zh') ? '—（上期为0）' : '— (previous period: 0)' : new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.percent / 100) }
}
export function freightDetailLocation(role: WorkbenchRole, query: FreightQuery, carrierCode?: FreightCarrier, periodId?: string, comparisonPeriod: 'current' | 'previous' = 'current') {
  return { name: 'RoleWorkbenchFreight', params: { role }, query: { ...query, ...(carrierCode ? { carrierCode } : {}), ...(periodId ? { periodId } : {}), comparisonPeriod, page: 1, pageSize: 20 } }
}
export function freightChartOption(data: FreightData, compare: boolean, locale: string, carrierCode?: FreightCarrier): EChartsCoreOption {
  const zh = locale.startsWith('zh')
  const series = freightSeries(data).filter(row => !carrierCode || row.carrierCode === carrierCode)
  const rowName = (row: FreightSeries) => row.carrierCode ? freightCarrierName(row.carrierCode, locale) : zh ? '合计' : 'Total'
  const periodName = (index: number) => {
    const period = data.periods[index]
    return period ? `${period.label}${period.partial ? zh ? '（未结束）' : ' (partial)' : ''}` : ''
  }
  const tooltip = (input: { seriesId?: string; dataIndex?: number } | { seriesId?: string; dataIndex?: number }[]) => {
    const points = Array.isArray(input) ? input : [input]
    const lines = points.flatMap(point => {
      const row = series.find(row => row.id === point.seriesId)
      const value = point.dataIndex === undefined ? undefined : row?.values[point.dataIndex]
      if (!row || !value) return []
      const change = freightChange(value, locale)
      return [`${rowName(row)}  ${compare ? `${change.amount}  ${change.percent}` : formatChartCurrency(value.amount, locale)}`]
    })
    return [periodName(points[0]?.dataIndex ?? -1), ...lines].join('\n')
  }
  return {
    animationDuration: 200, aria: { enabled: true }, textStyle: { color: '#8793a7', fontFamily: 'inherit', fontSize: 11 },
    legend: { top: 0, type: 'scroll', icon: 'roundRect', itemWidth: 10, itemHeight: 7, textStyle: { color: '#8793a7', fontSize: 11 } },
    grid: { top: 50, left: 16, right: 20, bottom: 70, containLabel: true },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: tooltip },
    xAxis: { type: 'category', data: data.periods.map((_, index) => periodName(index)), axisLine: { lineStyle: { color: '#8793a733' } }, axisTick: { show: false }, axisLabel: { color: '#8793a7', fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', name: compare ? zh ? '环比差额 · $' : 'Change · $' : '$', axisLabel: { formatter: (n: number) => `$${new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`, color: '#8793a7' }, splitLine: { lineStyle: { color: '#8793a718' } } },
    dataZoom: [{ type: 'slider', xAxisIndex: 0, bottom: 7, height: 18, start: Math.max(0, (data.periods.length - 6) / Math.max(1, data.periods.length) * 100), end: 100, brushSelect: false, zoomLock: true, showDetail: false, borderColor: 'transparent', fillerColor: '#94a5dd30', handleStyle: { color: '#94A5DD' } }],
    series: series.map(row => ({ id: row.id, name: rowName(row), type: carrierCode && !compare ? 'line' : 'bar', symbolSize: 6, smooth: false, barMaxWidth: carrierCode ? 30 : 18, barGap: '15%', itemStyle: { color: colors[row.kind === 'total' ? 0 : freightCarriers.indexOf(row.carrierCode!) + 1], borderRadius: [3, 3, 0, 0] }, data: row.values.map(value => compare ? value.delta : value.amount) })),
  }
}
