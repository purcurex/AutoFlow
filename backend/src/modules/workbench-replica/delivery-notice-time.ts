import { normalizeBusinessTimestamp } from '../fop-data/fop-business-time'

/** WMS creation uses the latest effective delivery-notice approval, never order approval. */
export function deliveryNoticeWmsTime(notices: { billstatus?: string; auditdate?: unknown }[]): string | null {
 const times=notices.filter(n=>n.billstatus==='C').map(n=>normalizeBusinessTimestamp(n.auditdate)).filter((t):t is string=>!!t)
 return times.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null
}
