import Decimal from 'decimal.js'
import type { FopOrder, FopOrderPageQuery } from './fop-data.types'
import { compareFulfillmentOrders } from './fop-order-sort'
import { consumerPaymentRange } from './consumer-payment-range'
import { normalizeBusinessTimestamp } from './fop-business-time'

type Row = Record<string, unknown>
const object = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid sales completion fact'); return v as Row }
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const number = (v: unknown) => {
  if (typeof v !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(v)) throw new Error('Invalid completion decimal')
  const n = new Decimal(v)
  if (!n.isFinite() || n.abs().gt(Number.MAX_SAFE_INTEGER)) throw new Error('Completion decimal overflow')
  return n.toNumber()
}
const ref = (v: unknown) => v == null ? undefined : { id: text(object(v).id), name: text(object(v).name) }
const image = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 2000) return null
  try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null } catch { return null }
}

/** Source approval alone defines the sales archive. Other fulfillment phases remain independent. */
export function completedSalesRows(rows: Row[], query: FopOrderPageQuery, warehouses: Record<string, 'HZ' | 'SZ'>, allStates = false): FopOrder[] {
  const inRange = consumerPaymentRange(query.completed ? query.timeRange ?? '1w' : query.timeRange)
  const orders: FopOrder[] = []
  for (const raw of rows) {
    if (object(raw.hzkj_billtype).number !== 'hzkj_orders_BT' || !['A','B','C'].includes(text(raw.billstatus))) continue
    const cancelled = raw.hzkj_orderstatus === '0', approved = raw.billstatus === 'C', paid = raw.hzkj_receipt_status === '1'
    if (!allStates && (query.completed ? !approved : cancelled || (query.queue === 'unpaid' ? paid : !paid || !['A','B'].includes(text(raw.billstatus))))) continue
    const paidAt = normalizeBusinessTimestamp(raw.hzkj_receipt_date)
    if (!inRange(paidAt)) continue
    const organization = ref(raw.hzkj_org)!, owner = ref(raw.hzkj_operator), department = ref(raw.hzkj_dept)!, customer = ref(raw.hzkj_customer), shop = ref(raw.hzkj_shop), warehouse = ref(raw.hzkj_dst_warehouse)
    const currency = text(object(raw.hzkj_currency).number)
    if (!/^[A-Z]{3}$/.test(currency) || !['0', '1'].includes(text(raw.hzkj_receipt_status)) || !Array.isArray(raw.hzkj_orders_billentry)) throw new Error('Incomplete sales completion fact')
    const lineIds = new Set<string>()
    const items = raw.hzkj_orders_billentry.map(value => {
      const line = object(value), sku = line.hzkj_local_sku == null ? {} : object(line.hzkj_local_sku)
      const id = text(line.id), quantity = number(line.hzkj_qty)
      if (!/^[1-9]\d*$/.test(id) || lineIds.has(id) || quantity < 0) throw new Error('Invalid completed sales line')
      lineIds.add(id)
      return { id, parentId: text(line.pid), sku: text(sku.number), name: text(sku.name), quantity,
        variant: Array.isArray(sku.hzkj_sku_values) ? sku.hzkj_sku_values.map(v => text(object(v).name)).filter(Boolean).join(' / ') : '',
        imageUrl: image(sku.hzkj_picturefield) ?? image(line.hzkj_picture) }
    })
    const country = raw.hzkj_country == null ? '' : text(object(raw.hzkj_country).twocountrycode)
    const order: FopOrder = {
      id: text(raw.id), orderNumber: text(raw.billno), shopifyOrderNumber: text(raw.hzkj_source_number), organization, owner, department,
      departmentPathIds: Array.isArray(raw.departmentPathIds) ? raw.departmentPathIds.map(text) : [], customerId: customer?.id, customerName: customer?.name ?? '', storeName: shop?.name ?? '',
      items, amount: number(raw.hzkj_order_amount), currency, paymentStatus: raw.hzkj_receipt_status === '1' ? 'paid' : 'unpaid', reviewStatus: approved ? 'approved' : 'pending',
      reviewedAt: normalizeBusinessTimestamp(raw.auditdate), consumerPaidAt: paidAt, paidAt: normalizeBusinessTimestamp(raw.hzkj_receipt_date), createdAt: text(raw.createtime),
      procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: 'unknown',
      fulfillmentProgress: { allocationCreated: null, shopifySync: 'unknown', supplierShipment: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', outbound: 'unknown' },
      warehouse: warehouse?.name ?? '', ...(warehouse && warehouses[warehouse.id] ? { warehouseCode: warehouses[warehouse.id] } : {}),
      carrier: null, trackingNumber: null, salesperson: owner?.name ?? '', cancelled, exception: null,
      shippingCountryCode: /^[A-Z]{2}$/.test(country) ? country : null,
      shippingRecipient: { name: [text(raw.hzkj_customer_first_name), text(raw.hzkj_customer_last_name)].filter(Boolean).join(' ') || null,
        phone: text(raw.hzkj_phone) || null, email: text(raw.hzkj_email) || null, state: text(raw.hzkj_state) || null, city: text(raw.hzkj_city) || null,
        postalCode: text(raw.hzkj_post_code) || null, addressLine1: text(raw.hzkj_address1) || null, addressLine2: text(raw.hzkj_address2) || null },
    }
    if (query.orderNumber && order.orderNumber !== query.orderNumber || query.warehouseCode && order.warehouseCode !== query.warehouseCode
      || query.shippingCountryCode && order.shippingCountryCode !== query.shippingCountryCode) continue
    const search = query.search?.trim().toLowerCase()
    if (search && ![order.orderNumber, order.shopifyOrderNumber, order.customerName, order.storeName, owner?.name, ...items.flatMap(i => [i.sku, i.name])].some(v => v?.toLowerCase().includes(search))) continue
    if (query.orderIds && !query.orderIds.includes(order.id)) continue
    orders.push(order)
  }
  return orders.sort((a,b) => compareFulfillmentOrders(a,b,{ queue: query.queue as 'unpaid' | 'review', completed: query.completed,
    sortBy: query.sortBy as 'completedAt' | 'paidAt' | 'consumerPaidAt', sortOrder: query.sortOrder, paidAtOrder: query.paidAtOrder }))
}
