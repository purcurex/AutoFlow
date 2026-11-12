import type { LogisticsInfo, LogisticsTrackingNumber } from './fop-data.types'

const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() || null : null
const trackingTypes = new Set(['full', 'first_mile', 'last_mile'])

/** Keep each shipment's carrier and numbers together; never infer a tracking type. */
export function normalizeLogisticsInfo(value: unknown, allTracking = false): LogisticsInfo[] | null {
  if (!Array.isArray(value)) return null
  const groups: LogisticsInfo[] = []
  for (const group of value) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    const carrierName = text(group.carrierName)
    const selected = group.shopifyTracking
    const number = text(selected?.number)
    const shopifyTracking: LogisticsTrackingNumber | null = number && trackingTypes.has(selected?.type)
      ? { type: selected.type, number } : null
    const channelName = text(group.channelName), channelCode = text(group.channelCode)
    const trackingNumbers: LogisticsTrackingNumber[] = allTracking && Array.isArray(group.trackingNumbers) ? group.trackingNumbers.filter((t: any) => ['full','last_mile'].includes(t?.type) && text(t?.number)).map((t: any) => ({type:t.type,number:text(t.number)!})) : []
    if (carrierName || channelName || shopifyTracking || trackingNumbers.length) groups.push({ carrierName, channelName, channelCode, shopifyTracking, ...(allTracking ? {trackingNumbers} : {}) })
  }
  return groups.length ? groups : null
}

export function logisticsInfoText(groups: unknown, _carrier?: string | null, _trackingNumber?: string | null, channels?: { name: string | null; code: string | null }[] | null, allTracking = false, missingTracking = '—'): string {
  const normalized = normalizeLogisticsInfo(groups, allTracking)
  if (!normalized) return channels?.length ? channels.map(c => `${text(c.name) || '—'}\n${missingTracking}`).join('\n\n') : missingTracking === '—' ? '—' : `—\n${missingTracking}`
  return normalized.map(group => [group.channelName || (normalized.length === 1 && channels?.length === 1 ? text(channels[0].name) : null) || '—',
    (allTracking ? group.trackingNumbers?.map(t => `${t.number} ${t.type==='full'?'QC':'WC'}`).join('\n') : group.shopifyTracking?.number) || missingTracking].join('\n')).join('\n\n')
}
