import { describe, expect, it } from 'vitest'
import { freightChartOption, freightChange, freightSeries, freightDetailLocation } from '@/utils/freight'
import { freightData } from './freight-fixtures'

describe('freight presentation', () => {
  it('places total beside the six carriers without stacking or summing it twice', () => {
    const data = freightData()
    data.series.reverse()
    expect(freightSeries(data).map(row => row.label)).toEqual(['合计', '云途YT', '4PX', '万邦WB', '燕文YW', '极速JS', '其他'])
    const option = freightChartOption(data, false, 'zh-CN') as any
    expect(option.series.map((row: any) => row.type)).toEqual(Array(7).fill('bar'))
    expect(option.series.every((row: any) => !row.stack)).toBe(true)
    expect(option.series[0].itemStyle.color).toBe('#94A5DD')
    expect(option.series[0].data).toEqual([20, 40])
    expect(option.dataZoom.every((zoom: any) => zoom.type === 'slider')).toBe(true)
  })
  it('uses supplied previous-period deltas and identifies partial periods', () => {
    const option = freightChartOption(freightData(), true, 'zh-CN') as any
    expect(option.series[0].data).toEqual([10, 20])
    expect(option.tooltip.formatter([{ seriesId: 'total', dataIndex: 1 }])).toContain('+$20.00')
    expect(option.tooltip.formatter([{ seriesId: 'total', dataIndex: 1 }])).toContain('+100.00%')
    expect(option.xAxis.data[1]).toContain('未结束')
    expect(freightChange({ amount: 10, previousAmount: 0, delta: 10, percent: null }, 'zh-CN')).toEqual({ amount: '+$10.00', percent: '—（上期为0）' })
    expect(freightChange({ amount: 5, previousAmount: 10, delta: -5, percent: -50 }, 'en-US').percent).toBe('-50.00%')
  })
  it('uses a single carrier line for amounts and bars for differences', () => {
    const option = freightChartOption(freightData(), false, 'zh-CN', 'YT') as any
    expect(option.series).toHaveLength(1)
    expect(option.series[0].type).toBe('line')
    expect(option.series[0].data).toEqual([20, 40])
    expect((freightChartOption(freightData(), true, 'zh-CN', 'YT') as any).series[0].type).toBe('bar')
  })
  it('keeps carrier, warehouse, week anchor and previous-period filters in the workbench link', () => {
    expect(freightDetailLocation('dispatch', { grain: 'week', year: 2026, weekOf: '2026-10-22', warehouse: 'HZ' }, 'YT', '2026-10-19', 'previous')).toEqual({ name: 'RoleWorkbenchFreight', params: { role: 'dispatch' }, query: { grain: 'week', year: 2026, weekOf: '2026-10-22', warehouse: 'HZ', carrierCode: 'YT', periodId: '2026-10-19', comparisonPeriod: 'previous', page: 1, pageSize: 20 } })
  })
})
