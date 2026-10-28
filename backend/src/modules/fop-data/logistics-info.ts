import type { LogisticsInfo, LogisticsTrackingNumber } from './fop-data.types'

const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() || null : null
const trackingTypes = new Set(['full', 'first_mile', 'last_mile'])

/** Keep each shipment's carrier and numbers together; never infer a tracking type. */
export function normalizeLogisticsInfo(value: unknown): LogisticsInfo[] | null {
  if (!Array.isArray(value)) return null
  const groups: LogisticsInfo[] = []
  for (const group of value) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    const carrierName = text(group.carrierName)
    const selected = group.shopifyTracking
    const number = text(selected?.number)
    const shopifyTracking: LogisticsTrackingNumber | null = number && trackingTypes.has(selected?.type)
      ? { type: selected.type, number } : null
    if (carrierName || shopifyTracking) groups.push({ carrierName, shopifyTracking })
  }
  return groups.length ? groups : null
}

export function logisticsInfoText(groups: unknown, carrier?: string | null, _trackingNumber?: string | null): string {
  const normalized = normalizeLogisticsInfo(groups)
  if (!normalized) return text(carrier) ? `${text(carrier)}\n—` : '—'
  const labels = { full: 'QC', first_mile: 'TC', last_mile: 'WC' }
  return normalized.map(group => [group.carrierName || '—', group.shopifyTracking
    ? `${labels[group.shopifyTracking.type]}: ${group.shopifyTracking.number}` : '—'].join('\n')).join('\n\n')
}
