import { normalizeBusinessTimestamp } from './fop-business-time'
/** Rolling seven days or calendar months in UTC+8; month ends clamp to the target month's last day. */
export function consumerPaymentRange(range: 'all' | '1w' | '1m' | '3m' | undefined, now = Date.now()): (value: unknown) => boolean {
  if (!range || range === 'all') return () => true
  let from = now - 7 * 24 * 3_600_000
  if (range !== '1w') {
    const offset = 8 * 3_600_000
    const start = new Date(now + offset)
    const day = start.getUTCDate()
    start.setUTCDate(1)
    start.setUTCMonth(start.getUTCMonth() - (range === '1m' ? 1 : 3))
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
    start.setUTCDate(Math.min(day, lastDay))
    from = start.getTime() - offset
  }
  return value => {
    const timestamp = normalizeBusinessTimestamp(value)
    if (!timestamp) return false
    const at = Date.parse(timestamp)
    return at >= from && at <= now
  }
}
