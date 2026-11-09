import Decimal from 'decimal.js'
import type { BusinessScope } from '../users/business-scope'
import { matchesBusinessScope } from '../users/business-scope'
import type { FopOrder, FopOrderPageQuery } from './fop-data.types'
import { FopPermissionDeniedError } from './fop-data.types'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'

export type Fact = Record<string, unknown>
export const Quantity = Decimal.clone({ precision: 80 })
export interface WorkbenchOrder { raw: Fact; order: FopOrder; lines: Fact[] }
export function fact(value: unknown): Fact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workbench fact')
  return value as Fact
}
export function text(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > 4000) throw new Error('Invalid workbench text')
  return value.trim()
}
export function at(value: Fact, path: string): unknown {
  let current: unknown = value
  for (const key of path.split('.')) { if (current == null) return null; current = fact(current)[key] }
  return current
}
export function rows(value: Fact, key: string, required = false): Fact[] {
  if (value[key] == null && !required) return []
  if (!Array.isArray(value[key]) || value[key].length > 20000) throw new Error('Invalid workbench rows: ' + key)
  return value[key].map(fact)
}
export function identifier(value: unknown): string {
  const result = text(value)
  if (!/^[1-9]\d{0,18}$/.test(result)) throw new Error('Invalid workbench identifier')
  return result
}
export function quantity(value: unknown, nullableZero = false): Decimal {
  if (value == null && nullableZero) return new Quantity(0)
  const source = text(value)
  if (!/^\d+(?:\.\d+)?$/.test(source) || source.length > 60) throw new Error('Invalid workbench quantity')
  const result = new Quantity(source)
  if (result.gt(Number.MAX_SAFE_INTEGER)) throw new Error('Workbench quantity overflow')
  return result
}
/** 库存余额允许负库存；需求数量仍使用非负quantity，不能混用。 */
export function stockBalance(value: unknown): Decimal {
  const source = text(value)
  if (!/^-?\d+(?:\.\d+)?$/.test(source) || source.length > 60) throw new Error('Invalid stock balance')
  return new Quantity(source)
}
export function timestamp(value: unknown): string | null {
  if (value == null || value === '') return null
  const result = text(value)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid workbench timestamp')
  return new Date(Date.parse(result)).toISOString()
}
export function documentStatus(value: unknown): 'draft' | 'submitted' | 'approved' | 'unknown' {
  return ['A', 'Z'].includes(text(value)) ? 'draft' : value === 'B' ? 'submitted' : value === 'C' ? 'approved' : 'unknown'
}
function reference(value: unknown) {
  if (value == null) return undefined
  const row = fact(value)
  return { id: identifier(row.id), name: text(row.name) }
}
export function validateResources(data: Fact, organizationIds: readonly string[], names: readonly string[]) {
  for (const key of names) {
    const seen = new Set<string>()
    for (const row of rows(data, key, true)) {
      const id = identifier(row.id)
      if (seen.has(id) || (key !== 'products' || row.organizationId != null) && !organizationIds.includes(identifier(row.organizationId))) throw new FopPermissionDeniedError('Workbench resource scope mismatch')
      seen.add(id)
    }
  }
}

/** 只解码已授权原始单据。阶段和最终过滤保留在AutoFlow；无法确认的付款事实不伪装为已付款。 */
export function decodeWorkbenchOrders(values: unknown[], organizations: readonly string[], scope: Readonly<BusinessScope>, queue: string, warehouseMap: Record<string, string>): WorkbenchOrder[] {
  const seen = new Set<string>(), result: WorkbenchOrder[] = []
  for (const value of values) {
    const raw = fact(value), id = identifier(raw.id), organization = reference(raw.hzkj_org), department = reference(raw.hzkj_dept), owner = reference(raw.hzkj_operator)
    if (seen.has(id) || !organization || !department || !owner || !organizations.includes(organization.id)) throw new FopPermissionDeniedError('Workbench order scope mismatch')
    seen.add(id)
    const departmentPathIds = kingdeeDepartmentPath(raw.departmentPathIds, organization.id, department.id, true)
    if (!matchesBusinessScope(scope, { owner, department, departmentPathIds }, true)) throw new FopPermissionDeniedError('Order outside workbench scope')
    if (raw.hzkj_use_status !== '1') throw new Error('Inactive workbench order')
    const status = text(raw.hzkj_orderstatus), unpaid = status === '1'
    if (!['1', '2', '3', '4', '5'].includes(status)) continue
    if (!unpaid && (text(at(raw, 'hzkj_billtype.number')) !== 'hzkj_orders_BT' || raw.hzkj_receipt_status !== '1')) continue
    const customer = reference(raw.hzkj_customer), store = reference(raw.hzkj_shop), warehouse = reference(raw.hzkj_dst_warehouse)
    const lines = rows(raw, 'hzkj_orders_billentry', true), lineIds = new Set<string>()
    const items = lines.map(line => {
      const lineId = identifier(line.id), seq = Number(text(line.seq)), sku = line.hzkj_local_sku == null ? null : fact(line.hzkj_local_sku)
      if (lineIds.has(lineId) || !Number.isSafeInteger(seq) || seq < 0) throw new Error('Invalid workbench source line')
      lineIds.add(lineId)
      return { id: lineId, parentId: text(line.pid) || '0', sku: sku ? text(sku.number) : '', name: sku ? text(sku.name) : '',
        variant: sku ? text(at(sku, 'hzkj_sku_values.name')) : '', quantity: quantity(line.hzkj_qty, true).toNumber(),
        imageUrl: text(line.hzkj_shopify_itemid) || !sku ? text(line.hzkj_picture) || null : text(sku.hzkj_picturefield) || null, seq }
    }).sort((a, b) => a.seq - b.seq).map(({ seq: _seq, ...item }) => item)
    const amount = text(raw.hzkj_order_amount) || '0', currency = text(at(raw, 'hzkj_currency.number'))
    if (!/^-?\d+(?:\.\d+)?$/.test(amount) || amount.length > 60 || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid workbench money')
    const outbound = ({ '0': 'pending', '1': 'partial', '2': 'completed' } as const)[text(raw.hzkj_delivery_status)] ?? 'unknown'
    const order: FopOrder = { id, orderNumber: text(raw.billno), organization, department, departmentPathIds, owner,
      customerId: customer?.id, customerName: customer?.name ?? '', storeName: store?.name ?? '', shopifyOrderNumber: text(raw.hzkj_source_number), items,
      amount: new Quantity(amount).toNumber(), currency, paymentStatus: unpaid ? 'unpaid' : 'paid', reviewStatus: raw.billstatus === 'C' ? 'approved' : 'pending',
      procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: status === '4' || outbound === 'completed' ? 'shipped' : 'pending',
      warehouse: warehouse?.name ?? '', ...(warehouse && warehouseMap[warehouse.id] ? { warehouseCode: warehouseMap[warehouse.id] } : {}),
      carrier: null, trackingNumber: null, salesperson: owner.name, cancelled: false, exception: null,
      createdAt: timestamp(raw.createtime)!, paidAt: unpaid ? null : timestamp(raw.hzkj_receipt_date), consumerPaidAt: timestamp(raw.hzkj_datetimefield), reviewedAt: timestamp(raw.auditdate),
      customLogisticsChannelName: text(at(raw, 'hzkj_customer_channel.name')) || null,
      shippingCountryCode: text(at(raw, 'hzkj_country.twocountrycode')).toUpperCase() || null,
      shippingRecipient: { name: [text(raw.hzkj_customer_first_name), text(raw.hzkj_customer_last_name)].filter(Boolean).join(' ') || null,
        phone: text(raw.hzkj_phone) || null, email: text(raw.hzkj_email) || null, state: text(raw.hzkj_state) || null, city: text(raw.hzkj_city) || null,
        postalCode: text(raw.hzkj_post_code) || null, addressLine1: text(raw.hzkj_address1) || null, addressLine2: text(raw.hzkj_address2) || null },
      fulfillmentProgress: { allocationCreated: null, shopifySync: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', supplierShipment: 'unknown', outbound } }
    if (!order.createdAt || !order.orderNumber || order.shippingCountryCode && !/^[A-Z]{2}$/.test(order.shippingCountryCode)) throw new Error('Invalid workbench order fields')
    // 原采购口径保留：退款释放和全部发货订单不重新进入进行中的采购清单。
    if (queue.startsWith('procurement') && (unpaid || raw.billstatus !== 'C' || status === '4' || !['', 'none', 'partial_refunded'].includes(text(raw.hzkj_refund_status)))) continue
    result.push({ raw, order, lines })
  }
  return result
}

export function synchronized(doc: Fact): boolean {
  if (!['FULFILLED', 'PLATFORM_DONE'].includes(text(doc.hzkj_delivery_status)) || doc.checkpoint == null) return false
  const checkpoint = fact(doc.checkpoint)
  return !!text(checkpoint.tracking) && (!!text(checkpoint.fulfillmentId)
    || Array.isArray(checkpoint.partialFulfillmentIds) && checkpoint.partialFulfillmentIds.length > 0
    && checkpoint.partialFulfillmentIds.every(value => typeof value === 'string' && !!value.trim()))
}
export function effectiveDispatches(data: Fact, item: WorkbenchOrder): Fact[] {
  return rows(data, 'dispatches', true).filter(doc => text(doc.hzkj_order_no) === item.order.orderNumber
    && text(at(doc, 'hzkj_customer.id')) === (item.order.customerId ?? '') && text(doc.hzkj_platform_orderid) === text(item.raw.hzkj_sourceid)
    && !text(doc.hzkj_rma_billno) && text(doc.hzkj_delivery_status).toUpperCase() !== 'CANCELLED'
    && text(doc.hzkj_fulfillment_status).toLowerCase() !== 'cancelled')
}

/** 同包裹重建发运后，以最新有效记录判断当前同步/异常；旧单仍用于实际出库追溯。 */
export function latestDispatches(data: Fact, item: WorkbenchOrder): Map<string, Fact> {
  const latest = new Map<string, Fact>()
  for (const doc of effectiveDispatches(data, item).sort((a, b) => (timestamp(a.createtime) ?? '').localeCompare(timestamp(b.createtime) ?? '')
    || (BigInt(identifier(a.id)) < BigInt(identifier(b.id)) ? -1 : 1))) latest.set(text(doc.hzkj_src_package), doc)
  return latest
}

/** 全部期望包裹以最新发运记录为准，完成事实与审核时间分开计算，缺包裹不能冒充完成。 */
export function appendDispatchFacts(item: WorkbenchOrder, data: Fact): void {
  const latest = latestDispatches(data, item)
  const expected = [...new Set(rows(item.raw, 'hzkj_logistics_info').map(row => text(row.hzkj_combofield)).filter(Boolean))]
  let rank = 4, unknown = !text(item.raw.hzkj_sourceid) || !expected.length
  for (const key of expected) {
    const doc = latest.get(key)
    if (!doc) { rank = Math.min(rank, 0); continue }
    if (synchronized(doc)) continue
    const state = documentStatus(doc.billstatus)
    if (state === 'unknown') unknown = true
    rank = Math.min(rank, state === 'draft' ? 1 : state === 'submitted' ? 2 : 3)
  }
  const stage = unknown ? 'unknown' : ['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'dispatch_synced'][rank] as NonNullable<FopOrder['dispatchTaskStatus']>
  item.order.dispatchTaskStatus = stage
  item.order.fulfillmentProgress.shopifySync = stage === 'dispatch_synced' ? 'synced' : 'pending'
  const documents = [...latest.values()]
  item.order.dispatchDocuments = documents.map(doc => ({ id: identifier(doc.id), number: text(doc.billno), status: documentStatus(doc.billstatus) }))
  const approvals = documents.map(doc => timestamp(doc.auditdate))
  item.order.dispatchApprovedAt = stage === 'dispatch_synced' && approvals.length && approvals.every(Boolean) ? approvals.sort().slice(-1)[0]! : null
  item.order.logisticsInfo = documents.map(doc => {
    const head = text(doc.hzkj_logistics_orderno), tail = text(doc.hzkj_logistics_trackno)
    const wms = text(at(doc, 'hzkj_logistics_providers.number')) === text(data.fpxCarrierCode) && !!text(data.shenzhenWarehouseCode)
      && text(at(doc, 'hzkj_basedatafield.number')) === text(data.shenzhenWarehouseCode)
    const full = doc.hzkj_upload_no === true && !wms, number = full ? head : tail && tail !== head ? tail : ''
    return { carrierName: text(at(doc, 'hzkj_logistics_providers.name')) || null,
      shopifyTracking: number ? { type: full ? 'full' as const : 'last_mile' as const, number } : null }
  })
  item.order.carrier = [...new Set(item.order.logisticsInfo.map(row => row.carrierName).filter(Boolean))].join(' / ') || null
  item.order.trackingNumber = [...new Set(item.order.logisticsInfo.map(row => row.shopifyTracking?.number).filter(Boolean))].join(' / ') || null
}
