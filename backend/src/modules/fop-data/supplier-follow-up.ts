import { createHash } from 'crypto'
import type { FopIdentity, FopPermissionGrant } from './fop-data.types'

export interface SupplierFollowUpCandidate {
  tenantId: string
  fulfillmentOrderId: string
  purchaseOrderId: string
  purchaseOrderNumber: string
  platformOrderNumber: string | null
  supplier: { id: string; name: string; wangwangAccount: string | null }
  /** Obtained by the trusted FOP adapter, never supplied by an HTTP caller. */
  chatUrl: string | null
  paid: boolean
  cancelled: boolean
  shipmentStatus: 'pending' | 'partial' | 'shipped' | 'unknown'
  /** Only the queried fulfillment order's effective source-linked lines. */
  lines: { fulfillmentLineId: string; purchaseLineId: string; sku: string; name: string; pendingQuantity: number }[]
}
export interface SupplierFollowUpResult { subject: FopIdentity; orderId: string; items: SupplierFollowUpCandidate[] }

const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
/** Deliberately narrow. New FOP launch formats require a reviewed adapter change. */
export function safeWangwangUrl(raw: unknown, account: string | null): string | null {
  if (!nonempty(account) || account.length > 128 || [...account].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || typeof raw !== 'string' || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'aliim:' || url.pathname !== 'sendmsg' || url.host || url.hash) return null
    const entries = [...url.searchParams.entries()]
    if (entries.some(([key]) => !['touid', 'siteid'].includes(key)) || new Set(entries.map(([key]) => key)).size !== entries.length) return null
    if (url.searchParams.get('touid') !== `cnalichn${account}` || (url.searchParams.has('siteid') && url.searchParams.get('siteid') !== 'cnalichn')) return null
    return `aliim:sendmsg?touid=${encodeURIComponent(`cnalichn${account}`)}`
  } catch { return null }
}

export function supplierFollowUps(result: SupplierFollowUpResult, identity: FopIdentity, permission: FopPermissionGrant, orderId: string) {
  if (result?.subject?.tenantId !== identity.tenantId || result?.subject?.userId !== identity.userId || result.orderId !== orderId || !Array.isArray(result.items)) throw new Error('Invalid supplier follow-up response')
  const allowed = new Set(permission.allowedPurchaseOrderIds ?? [])
  const ids = new Set<string>()
  return result.items.flatMap(row => {
    if (!row || row.tenantId !== identity.tenantId || row.fulfillmentOrderId !== orderId || !allowed.has(row.purchaseOrderId)
      || row.cancelled !== false || row.paid !== true || !['pending', 'partial'].includes(row.shipmentStatus)) return []
    if (!nonempty(row.purchaseOrderId) || !nonempty(row.purchaseOrderNumber) || !nonempty(row.supplier?.id) || !nonempty(row.supplier?.name)
      || row.platformOrderNumber !== null && !nonempty(row.platformOrderNumber) || !Array.isArray(row.lines) || ids.has(row.purchaseOrderId)) throw new Error('Invalid or duplicate supplier purchase')
    ids.add(row.purchaseOrderId)
    const lineIds = new Set<string>()
    const lines = row.lines.map(line => {
      if (!line || !nonempty(line.fulfillmentLineId) || !nonempty(line.purchaseLineId) || !nonempty(line.sku) || !nonempty(line.name)
        || !Number.isFinite(line.pendingQuantity) || line.pendingQuantity < 0 || lineIds.has(`${line.fulfillmentLineId}:${line.purchaseLineId}`)) throw new Error('Invalid purchase source linkage')
      lineIds.add(`${line.fulfillmentLineId}:${line.purchaseLineId}`)
      return { fulfillmentLineId: line.fulfillmentLineId, purchaseLineId: line.purchaseLineId, sku: line.sku, name: line.name, pendingQuantity: line.pendingQuantity }
    }).filter(line => line.pendingQuantity > 0)
    if (!lines.length) return []
    const account = row.supplier.wangwangAccount?.trim() || null
    const url = safeWangwangUrl(row.chatUrl, account)
    const availability = !account ? 'missing_account' as const : url ? 'ready' as const : 'chat_unavailable' as const
    const supplier = { id: row.supplier.id, name: row.supplier.name, wangwangAccount: account }
    const contactVersion = createHash('sha256').update(JSON.stringify([orderId, row.purchaseOrderId, row.purchaseOrderNumber, row.platformOrderNumber, supplier, lines, url])).digest('hex')
    return [{ purchaseOrderId: row.purchaseOrderId, purchaseOrderNumber: row.purchaseOrderNumber, platformOrderNumber: row.platformOrderNumber, supplier, shipmentStatus: row.shipmentStatus as 'pending' | 'partial', lines, availability, contactVersion, url }]
  })
}
