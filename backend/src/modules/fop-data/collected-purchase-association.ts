import { purchaseLogisticsSupplier } from './purchase-logistics-supplier'
import { purchasePayment } from './purchase-payment'
import { isVirtualProduct } from './physical-business-lines'
import Decimal from 'decimal.js'
type Row = Record<string, any>
export const purchaseReference = (v: unknown): string | null => {
 const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : ''
 return s && s !== '0' ? s : null
}
/** Sales reference is independent of the immediate source (often a purchase requisition). */
export function purchaseSalesReference(line: Row) {
 const direct = !line.hzkj_srcbillentity || line.hzkj_srcbillentity === 'hzkj_orders'
 const hasSalesNumber = Object.prototype.hasOwnProperty.call(line, 'hzkj_salbillnumber')
 return {
  number: typeof line.hzkj_srcbillnumber==='string'&&line.hzkj_srcbillnumber.startsWith('TO') ? purchaseReference(line.hzkj_srcbillnumber) : hasSalesNumber ? purchaseReference(line.hzkj_salbillnumber) : direct ? purchaseReference(line.hzkj_srcbillnumber) : null,
  id: purchaseReference(line.hzkj_salbillid) ?? (!hasSalesNumber && direct ? purchaseReference(line.hzkj_srcbillid) : null),
  entryId: purchaseReference(line.hzkj_salbillentryid) ?? (direct ? purchaseReference(line.hzkj_srcbillentryid) : null),
  sequence: purchaseReference(line.hzkj_salbillentryseq) ?? (direct ? purchaseReference(line.hzkj_srcbillentryseq) : null),
 }
}
export function purchaseFulfillmentLine(line: Row, parent: Row): Row | null {
 const ref = purchaseSalesReference(line)
 const candidates = (parent.hzkj_orders_billentry ?? []).filter((entry: Row) => ref.entryId ? String(entry.id) === ref.entryId : ref.sequence !== null && String(entry.seq) === ref.sequence)
 return candidates.length === 1 ? candidates[0] : null
}
/** Display/contact linkage only; does not allocate quantities or change procurement status. */
export function purchaseMatchesSourceSku(line: Row, parent: Row, skuId: string): boolean {
 const ref=purchaseSalesReference(line),sku=(l:Row)=>purchaseReference(l.hzkj_local_sku_id??l.hzkj_local_sku?.id)
 if(ref.number!==parent.billno||isVirtualProduct(line))return false
 const entries:Row[]=parent.hzkj_orders_billentry??[]
 const byId=ref.entryId?entries.filter(e=>purchaseReference(e.id)===ref.entryId):[]
 const bySequence=ref.sequence?entries.filter(e=>purchaseReference(e.seq)===ref.sequence):[]
 if(byId.length>1||bySequence.length>1||byId.length&&bySequence.length&&byId[0]!==bySequence[0])return false
 // Explicit, unique sales sequence can resolve a legacy optional ID that no longer matches.
 const entry=byId[0]??bySequence[0],ownSku=sku(line)
 if(entry&&(isVirtualProduct(entry)||sku(entry)!==skuId)||ownSku&&ownSku!==skuId)return false
 return !!entry||!!ownSku
}
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null
const quantity = (v: unknown): number | null => { try { if (v == null || v === '') return null; const d = new Decimal(String(v)), n = d.toNumber(); return d.isFinite() && d.gte(0) && n <= Number.MAX_SAFE_INTEGER && d.eq(String(n)) ? n : null } catch { return null } }
const date = (v: unknown): string | null => typeof v === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null
/** Caller supplies a company-scoped, unique-number lookup. Missing line identity does not discard order ownership. */
export function projectPurchaseOrderRows(raw: Row, lookup: (number: string) => Row | null | undefined, displayForParent?: (id: string) => Row | undefined) {
 const rows = new Map<string, Row>(), unresolvedNumbers = new Set<string>()
 let unresolved = 0
 for (const line of raw.hzkj_billentry ?? []) {
  const ref = purchaseSalesReference(line), candidate = ref.number ? lookup(ref.number) : null
  // The FOP purchase entry's sales number is authoritative. Optional legacy IDs do not veto it.
  const parent = candidate ?? null
  const entry = parent ? purchaseFulfillmentLine(line, parent) : null
  if (!parent) { unresolved++; if (ref.number) unresolvedNumbers.add(ref.number) }
  const key = parent?.id ?? 'unresolved:' + (ref.number ?? String(line.id))
  let row = rows.get(key)
  if (!row) {
   row = { rawOrderStatus:parent?.hzkj_orderstatus??null, orderId: parent?.id ?? null, orderNumber: parent?.billno ?? ref.number, associationState: parent ? 'verified' : 'unresolved',
    ownerEmployeeId: purchaseReference(parent?.hzkj_operator?.id), ownerName: text(parent?.hzkj_operator?.name),
    shopifyOrderNumber: text(parent?.hzkj_source_number), customerName: text(parent?.hzkj_customer?.name), storeName: text(parent && displayForParent?.(parent.id)?.storeName) ?? text(parent?.hzkj_shop?.name),
    departmentName: text(parent?.hzkj_dept?.name), warehouse: text(parent?.hzkj_dst_warehouse?.name), warehouseCode: text(parent?.hzkj_dst_warehouse?.number), paidAt: date(parent?.hzkj_receipt_date), lines: [] }
   rows.set(key, row)
  }
  const sku = entry?.hzkj_local_sku ?? line.hzkj_material ?? line.hzkj_local_sku ?? {}
  row.lines.push({ purchaseLineId: purchaseReference(line.id), fulfillmentLineId: entry?.id ?? null,
   associationState: parent ? 'verified' : 'unresolved', lineAssociationState: entry ? 'verified' : 'unresolved',
   ...(isVirtualProduct(entry??line)?{isVirtual:true}:{}), sku: text(sku.number), name: text(sku.name), variant: text(sku.hzkj_sku_value) ?? (Array.isArray(sku.hzkj_sku_values) ? text(sku.hzkj_sku_values.map((v: Row) => v.name).filter(Boolean).join(' / ')) : null), imageUrl: text(sku.hzkj_picturefield),
   quantity: quantity(line.hzkj_qty), shippedQuantity: null, rawPurchaseEntryStatus: entry?.hzkj_entrypurc_status ?? null })
 }
 return { rows: [...rows.values()], unresolved, unresolvedNumbers }
}

/** Same native header mapping for initial capture and incremental publication. */
export function purchaseGroupFacts(raw: Row, rows: Row[], unresolved: number): Row {
 const payment = purchasePayment(raw)
 const online = raw.hzkj_purchase_channel === '1', offline = raw.hzkj_purchase_channel === '2'
 const platformOrder = text(raw.hzkj_1688_order_n)
 const placement = ['paid','refunded','partially_refunded'].includes(payment) || offline ? 'placed' : online && raw.hasAlibabaOffer === true ? (platformOrder ? 'placed' : 'pending') : 'unknown'
 const shipment = ['1','2'].includes(raw.hzkj_ship_status) || ['C','D','E','F','G'].includes(raw.hzkj_logisticsstatus) ? 'shipped' : raw.hzkj_ship_status === '0' || raw.hzkj_logisticsstatus === 'A' ? 'pending' : raw.hzkj_logisticsstatus === 'B' ? 'partial' : 'unknown'
 const stage = raw.hzkj_cancelstatus === 'B' || payment === 'cancelled' ? 'cancelled' : ['refunded','partially_refunded'].includes(payment) ? 'refund_pending' : placement === 'pending' ? 'placement_pending' : payment === 'unpaid' ? 'payment_pending' : placement === 'placed' && payment === 'paid' ? (shipment === 'shipped' ? 'shipped' : shipment === 'pending' ? 'supplier_pending' : shipment === 'partial' ? 'supplier_partial' : 'unknown') : 'unknown'
 return {id:`purchase:${raw.id}`,kind:'purchase',purchase:{id:raw.id,number:raw.billno,supplier:purchaseLogisticsSupplier(raw),purchaseType:online?'online':offline?'offline':'unknown',platform:online&&raw.hasAlibabaOffer===true?'1688':null,platformOrderNumber:platformOrder,payment,paymentName:text(raw.hzkj_pay_status_title),actualPaidAmount:quantity(raw.hzkj_actual_amount),actualPaidFreight:quantity(raw.hzkj_actual_free),placement,paidAt:date(raw.hzkj_pay_time)},rawBillStatus:raw.billstatus??null,rawPaymentStatus:raw.hzkj_pay_status??null,rawStandardPaymentStatus:raw.hzkj_paystatus??null,rawCancelStatus:raw.hzkj_cancelstatus??null,shipment,stage,rows,association:{state:unresolved?'partial':'verified',unresolvedLineCount:unresolved},completedAt:null}
}
