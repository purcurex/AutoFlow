import { normalizeBusinessTimestamp } from './fop-business-time'
/** FOP fulfillment header write-back time. Unzoned source timestamps are Beijing time. */
export function orderOutboundTime(value: unknown): string | null {
 if(typeof value !== 'string')return null
 const s=value.trim()
 const zoned=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(s)?s.replace(' ','T')+'+08:00':s
 return normalizeBusinessTimestamp(zoned)
}
