import type { VolumeGrain, VolumeSeries } from '@/api/fop-order-volume'
export function latestVolumeWindow(grain: VolumeGrain, periods: { future: boolean }[]) {
  const last = Math.max(0, periods.filter(p => !p.future).length - 1)
  return { startValue: Math.max(0, last - (grain === 'day' ? 14 : grain === 'month' ? 6 : 4) + 1), endValue: last }
}
const colors = ['#64BDB1', '#E7B96C', '#E49AA5', '#A996D1', '#79B7D2', '#B3BF78', '#79BCA5', '#D3ACCB', '#93B5D7', '#C1B290']
const carrierColors: Record<string, string> = { 'carrier:YT': '#64BDB1', 'carrier:4PX': '#79B7D2', 'carrier:WB': '#E7B96C', 'carrier:YW': '#A996D1', 'carrier:JS': '#E49AA5', 'carrier:OTHER': '#B5BFCE' }
export function volumeColor(series: Pick<VolumeSeries, 'id' | 'kind'>) {
  if (series.kind === 'total') return '#94A5DD'
  if (carrierColors[series.id]) return carrierColors[series.id]!
  if (series.kind === 'other' || series.kind === 'unassigned') return '#B5BFCE'
  return colors[[...series.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length]!
}
