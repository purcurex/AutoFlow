import Decimal from 'decimal.js'
import { normalizeBusinessTimestamp } from './fop-business-time'

type Row = Record<string, unknown>
type SourceType = 'A' | 'B' | 'C'
const sourceType = (value: unknown): SourceType | null => value === 'A' || value === 'B' || value === 'C' ? value : null
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value
const blank = (value: unknown) => value == null || typeof value === 'string' && !value.trim()

export function customerPaymentKey(organizationId: string, sourceType: SourceType, orderNumber: string): string {
  return JSON.stringify([organizationId, sourceType, orderNumber])
}

function actualAmount(value: unknown): Decimal {
  // The live query API sends JSON numbers. Only inspect their sign; never return or sum this money.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid customer payment decimal')
    return new Decimal(String(value))
  }
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid customer payment decimal')
  const amount = new Decimal(value)
  if (!amount.isFinite()) throw new Error('Invalid customer payment decimal')
  return amount
}

/** Latest actual customer payment, linked only by explicit organization, entry type and exact bill number. */
export function buildCustomerPaymentIndex(receipts: Row[], organizationIds: readonly string[]): Map<string, string> {
  const organizations = new Set(organizationIds)
  const receiptIds = new Set<string>()
  const index = new Map<string, string>()
  const unknown = new Set<string>()
  const now = Date.now()

  for (const receipt of receipts) {
    const organizationId = receipt.org_id
    if (!identifier(organizationId) || !organizations.has(organizationId)) throw new Error('Invalid customer payment organization')
    if (!identifier(receipt.id)) throw new Error('Invalid customer payment receipt ID')
    if (receiptIds.has(receipt.id)) throw new Error('Duplicate customer payment receipt ID')
    receiptIds.add(receipt.id)

    // Completed payment is independent of later receipt approval. Refunds and wallet recharges are not order payments.
    if (receipt.hzkj_receive_status !== 'B' || receipt.hzkj_void_status === '1'
      || !['A', 'B', 'C', 'E'].includes(receipt.hzkj_receive_type as string)) continue
    if (!Array.isArray(receipt.entryentity)) continue
    const receivedAt = normalizeBusinessTimestamp(receipt.hzkj_receive_time)
    const completedAt = receivedAt && Date.parse(receivedAt) <= now ? receivedAt : null

    for (const value of receipt.entryentity) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid customer payment entry')
      const entry = value as Row
      const type = sourceType(blank(entry.hzkj_entry_src_type) ? receipt.hzkj_src_type : entry.hzkj_entry_src_type)
      const orderNumber = entry.hzkj_src_order
      if (!type || !identifier(orderNumber)) continue
      const amount = blank(entry.hzkj_real_receive_amt) ? null : actualAmount(entry.hzkj_real_receive_amt)
      if (amount && !amount.gt(0)) continue
      const key = customerPaymentKey(organizationId, type, orderNumber)
      if (!amount || !completedAt) {
        // Missing actual amount or completion means an older known payment cannot prove the last time.
        unknown.add(key)
        index.delete(key)
        continue
      }
      if (unknown.has(key)) continue
      const previous = index.get(key)
      if (!previous || Date.parse(completedAt) > Date.parse(previous)) index.set(key, completedAt)
    }
  }
  return index
}
