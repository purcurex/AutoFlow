import { ServiceUnavailableException } from '@nestjs/common'
import { FopReceipt, FopReceiptCandidate, SALES_DEPARTMENTS } from './fop-data.types'
import { businessDate, BUSINESS_TIME_ZONE } from './fop-business-time'
import { moneyToCents } from './fop-order-totals'

export function safeCents(value: number): number {
  const cents = moneyToCents(value)
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents)) throw new Error('Invalid receipt amount')
  return cents
}
export function sumReceiptCents(values: number[]): number {
  return values.reduce((total, value) => {
    const sum = total + safeCents(value)
    if (!Number.isSafeInteger(sum)) throw new ServiceUnavailableException({ code: 'fop_unavailable', message: 'FOP collections exceed supported precision' })
    return sum
  }, 0)
}
export function publicReceipt(record: FopReceiptCandidate): FopReceipt {
  const validRef = (value: unknown): value is { id: string; name: string } => !!value && typeof value === 'object'
    && 'id' in value && typeof value.id === 'string' && !!value.id.trim()
    && 'name' in value && typeof value.name === 'string' && !!value.name.trim()
  for (const field of ['id', 'documentId', 'documentNumber', 'customerId', 'customerName', 'warehouseCode', 'warehouse'] as const) {
    if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error('Missing receipt field')
  }
  if (!['fulfillment', 'full_payment_stock', 'deposit_stock'].includes(record.sourceType)
    || !['approved', 'pending'].includes(record.reviewStatus) || !['approved', 'pending'].includes(record.receiptReviewStatus)
    || !['paid', 'unpaid', 'refunded'].includes(record.paymentStatus) || typeof record.cancelled !== 'boolean'
    || typeof record.currency !== 'string' || !/^[A-Z]{3}$/.test(record.currency) || !Array.isArray(record.items)
    || typeof record.customerCode !== 'string' || !validRef(record.owner) || !validRef(record.department)
    || record.organization !== undefined && !validRef(record.organization)
    || !SALES_DEPARTMENTS.some(d => d.id === record.salesDepartmentCode)
    || !['HZ', 'SZ'].includes(record.warehouseCode)
    || record.paidAt !== null && typeof record.paidAt !== 'string'
    || (record.sourceType === 'fulfillment' ? !['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER'].includes(record.carrierCode ?? '') : record.carrierCode !== null)
    || (record.paymentStatus === 'paid' && (!record.paidAt || !businessDate(record.paidAt)))) throw new Error('Invalid receipt contract')
  safeCents(record.amount); safeCents(record.orderAmount); safeCents(record.handlingFee)
  if (record.items.some(item => !item || typeof item.sku !== 'string' || !item.sku.trim() || typeof item.name !== 'string'
    || typeof item.variant !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 0
    || item.imageUrl !== null && typeof item.imageUrl !== 'string'
    || item.productId !== undefined && typeof item.productId !== 'string')) throw new Error('Invalid receipt SKU details')
  const ref = (value: { id: string; name: string }) => ({ id: value.id, name: value.name })
  return {
    id: record.id, sourceType: record.sourceType, documentId: record.documentId, documentNumber: record.documentNumber,
    customerId: record.customerId, customerCode: record.customerCode ?? '', customerName: record.customerName,
    ...(record.organization ? { organization: ref(record.organization) } : {}), department: ref(record.department), owner: ref(record.owner),
    salesDepartmentCode: record.salesDepartmentCode, warehouseCode: record.warehouseCode, warehouse: record.warehouse, carrierCode: record.carrierCode,
    amount: record.amount, orderAmount: record.orderAmount, handlingFee: record.handlingFee, currency: record.currency, paidAt: record.paidAt,
    reviewStatus: record.reviewStatus, receiptReviewStatus: record.receiptReviewStatus, paymentStatus: record.paymentStatus, cancelled: record.cancelled,
    items: record.items.map(({ productId, sku, name, imageUrl, variant, quantity }) => ({ ...(productId ? { productId } : {}), sku, name, imageUrl, variant, quantity })),
  }
}
export function eligibleReceipts(records: readonly FopReceipt[], now = new Date()): FopReceipt[] {
  return [...new Map(records.filter(r => r.sourceType !== 'deposit_stock' && r.reviewStatus === 'approved' && r.receiptReviewStatus === 'approved'
    && r.paymentStatus === 'paid' && !r.cancelled && r.paidAt && businessDate(r.paidAt) && Date.parse(r.paidAt) <= now.getTime())
    .map(r => [r.id, r])).values()]
}
export function summarizeReceipts(records: readonly FopReceipt[]) {
  const usd = records.filter(r => r.currency === 'USD')
  const amount = (list: readonly FopReceipt[], field: 'amount' | 'orderAmount' | 'handlingFee' = 'amount') => sumReceiptCents(list.map(r => r[field])) / 100
  return { receiptCount: usd.length, currency: 'USD' as const, amount: amount(usd),
    fulfillmentAmount: amount(usd.filter(r => r.sourceType === 'fulfillment')), fullPaymentStockAmount: amount(usd.filter(r => r.sourceType === 'full_payment_stock')),
    orderAmount: amount(usd, 'orderAmount'), handlingFee: amount(usd, 'handlingFee') }
}
export function monthlyReceipts(records: readonly FopReceipt[], year: number, enabled: boolean, now = new Date()) {
  const today = businessDate(now)
  const months = enabled ? Array.from({ length: year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`) : []
  const previousMonth = `${year - 1}-12`
  const rows = eligibleReceipts(records, now).filter(r => r.currency === 'USD')
  const series = (id: string, name: string, list: FopReceipt[]) => {
    const selected = (month: string) => list.filter(r => businessDate(r.paidAt!).slice(0, 7) === month)
    const previous = summarizeReceipts(selected(previousMonth)), buckets = months.map(month => summarizeReceipts(selected(month)))
    return { id, name, amounts: buckets.map(b => b.amount), previousAmount: previous.amount,
      breakdown: { fulfillment: buckets.map(b => b.fulfillmentAmount), fullPaymentStock: buckets.map(b => b.fullPaymentStockAmount) },
      previousBreakdown: { fulfillment: previous.fulfillmentAmount, fullPaymentStock: previous.fullPaymentStockAmount } }
  }
  const inYear = rows.filter(r => months.includes(businessDate(r.paidAt!).slice(0, 7)) || businessDate(r.paidAt!).slice(0, 7) === previousMonth)
  return { currency: 'USD' as const, timeZone: BUSINESS_TIME_ZONE, basis: 'actual_received' as const, months, ...(enabled ? { previousMonth } : {}),
    marketingCenter: enabled ? series('marketing', '营销中心', inYear) : null,
    departments: enabled ? SALES_DEPARTMENTS.map(d => {
      const list = inYear.filter(r => r.salesDepartmentCode === d.id)
      const owners = [...new Map(list.filter(r => r.owner).map(r => [r.owner!.id, r.owner!])).values()].sort((a, b) => a.id.localeCompare(b.id))
      return { ...series(d.id, d.name, list), salespeople: owners.map(owner => series(owner.id, owner.name, list.filter(r => r.owner?.id === owner.id))) }
    }) : [] }
}
