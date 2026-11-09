import type { PurchaseHeader, PurchaseLinkSnapshot, PurchaseObligation } from './procurement-groups.types'
import { validatedPurchaseHeader } from './procurement-groups'
import { at, fact, identifier, quantity, Quantity, rows, text, timestamp, type Fact, type WorkbenchOrder } from './workbench-facts'

/** 在AutoFlow按来源行计算需求、申请覆盖、有效采购与供应商发货；不按同SKU推测来源。 */
export function procurementFacts(orders: WorkbenchOrder[], data: Fact, shipping: boolean): PurchaseLinkSnapshot['orders'] {
  const products = new Map(rows(data, 'products', true).map(row => [identifier(row.id), row]))
  const source = new Map<string, Demand>(), sequences = new Map<string, Demand>(), applySources = new Map<string, Demand>()
  const applicationLinks = fact(data.applicationLinks ?? {}), purchaseLinks = fact(data.purchaseLinks ?? {}), receiptLinks = fact(data.receiptLinks ?? {})
  const packing = text(data.packingGroupType) || 'PNLX03', combination = text(data.combinationGroupType)
  const groups = new Map(orders.map(item => [item.order.id, [] as PurchaseObligation[]]))
  for (const item of orders) for (const line of item.lines) {
    const skuId = text(at(line, 'hzkj_local_sku.id')), product = skuId ? products.get(skuId) : undefined
    if (!skuId) continue
    if (!product) throw new Error('Missing procurement product fact')
    const type = text(at(product, 'hzkj_good.hzkj_goodtype.number'))
    if (text(at(product, 'hzkj_good.hzkj_good_carrier')) === '2' || type === packing || !!combination && type === combination
      || text(line.hzkj_use_stock) === '1' || ['3', '4'].includes(text(line.hzkj_entrypurc_status))) continue
    const needed = item.raw.hzkj_lock_store === '1' && line.hzkj_pay_prod_qty != null ? quantity(line.hzkj_pay_prod_qty) : quantity(line.hzkj_qty, true)
    if (needed.gt(quantity(line.hzkj_qty, true))) throw new Error('Procurement demand exceeds source')
    if (needed.isZero()) continue
    const id = identifier(line.id), key = item.order.orderNumber + ':' + text(line.seq)
    if (source.has(id) || sequences.has(key)) throw new Error('Ambiguous procurement source')
    const demand: Demand = { orderId: item.order.id, lineId: id, sku: text(at(line, 'hzkj_local_sku.number')), needed,
      committed: quantity(line.hzkj_purcqty, true), draft: new Quantity(0), purchased: new Quantity(0), groups: new Map() }
    source.set(id, demand); sequences.set(key, demand)
  }
  for (const bill of rows(data, 'applications', true)) {
    if (bill.hzkj_cancelstatus === 'B' || bill.hzkj_qty_released === '1') continue
    for (const line of rows(bill, 'entryentity', true)) {
      const copied = sequences.get(text(line.hzkj_srcbillnumber) + ':' + text(line.hzkj_srcbillentryseq)), linked = source.get(text(applicationLinks[identifier(line.id)]))
      if (copied && linked && copied !== linked) throw new Error('Inconsistent application source')
      const demand = linked ?? copied
      if (!demand) continue
      applySources.set(identifier(line.id), demand)
      if (bill.billstatus !== 'C') demand.draft = demand.draft.plus(quantity(line.hzkj_applyqty, true))
    }
  }
  const shipped = new Map<string, InstanceType<typeof Quantity>>(), packages = new Map<string, string>()
  for (const notice of rows(data, 'receiptNotices', true)) {
    if (notice.hzkj_cancelstatus === 'B') continue
    const logistics = text(notice.hzkj_logistics_number), waybill = text(notice.hzkj_waybill_number)
    if (!logistics && !waybill) continue
    const key = text(notice.hzkj_1688_order_n) + (logistics ? ':logistics:' + logistics : ':waybill:' + waybill)
    if (packages.has(key) && packages.get(key) !== identifier(notice.id)) throw new Error('Duplicate supplier shipment package')
    packages.set(key, identifier(notice.id))
    for (const line of rows(notice, 'entryentity', true)) {
      const origin = text(receiptLinks[identifier(line.id)]) || (line.hzkj_srcbillentity === 'hzkj_purorderbill' ? text(line.hzkj_srcbillentryid) : '')
      if (!origin || origin === '0') throw new Error('Missing supplier shipment source')
      shipped.set(origin, (shipped.get(origin) ?? new Quantity(0)).plus(quantity(line.hzkj_qty, true)))
    }
  }
  for (const bill of rows(data, 'purchases', true)) {
    if (bill.hzkj_cancelstatus === 'B') continue
    const purchase = header(bill), awaiting = purchase.payment === 'paid' && (purchase.purchaseType === 'offline' || purchase.placement === 'placed')
    for (const line of rows(bill, 'hzkj_billentry', true)) {
      const direct = source.get(text(line.hzkj_salbillentryid)), linked = applySources.get(text(purchaseLinks[identifier(line.id)]))
      const copied = sequences.get(text(line.hzkj_salbillnumber) + ':' + text(line.hzkj_salbillentryseq))
        ?? sequences.get(text(line.hzkj_srcbillnumber) + ':' + text(line.hzkj_srcbillentryseq))
      const demand = direct ?? linked ?? copied
      if (!demand) continue
      if (direct && direct !== demand || linked && linked !== demand || copied && copied !== demand
        || text(line.hzkj_salbillentryid) && text(line.hzkj_salbillentryid) !== '0' && text(line.hzkj_salbillentryid) !== demand.lineId) throw new Error('Inconsistent purchase source')
      const qty = quantity(line.hzkj_qty, true)
      demand.purchased = demand.purchased.plus(qty)
      if (qty.isZero() || shipping !== awaiting) continue
      const obligation = demand.groups.get(purchase.id) ?? { purchase, lines: [] }
      const sent = purchase.platform === '1688' ? shipped.get(identifier(line.id)) ?? new Quantity(0) : null
      if (sent?.gt(qty)) throw new Error('Supplier shipment exceeds purchase quantity')
      obligation.lines.push({ fulfillmentLineId: demand.lineId, purchaseLineId: identifier(line.id), sku: demand.sku,
        quantity: qty.toNumber(), shippedQuantity: sent?.toNumber() ?? null })
      demand.groups.set(purchase.id, obligation)
    }
  }
  for (const demand of source.values()) {
    const target = groups.get(demand.orderId)!
    target.push(...demand.groups.values())
    if (shipping) continue
    const available = Quantity.max(0, demand.needed.minus(demand.purchased))
    const missing = Quantity.max(0, demand.needed.minus(Quantity.max(demand.committed.plus(demand.draft), demand.purchased)))
    const awaiting = available.minus(missing), obligation: PurchaseObligation = { purchase: null, lines: [] }
    for (const [qty, stage] of [[missing, 'application_pending'], [awaiting, 'purchase_order_pending']] as const) {
      if (qty.gt(0)) obligation.lines.push({ fulfillmentLineId: demand.lineId, purchaseLineId: null, sku: demand.sku, quantity: qty.toNumber(), shippedQuantity: 0, demandStage: stage })
    }
    if (obligation.lines.length) target.push(obligation)
  }
  return [...groups].map(([orderId, obligations]) => {
    const merged = new Map<string, PurchaseObligation>()
    for (const obligation of obligations) {
      const key = obligation.purchase?.id ?? 'uncreated', existing = merged.get(key)
      if (existing) {
        if (JSON.stringify(existing.purchase) !== JSON.stringify(obligation.purchase)) throw new Error('Inconsistent purchase header')
        existing.lines.push(...obligation.lines)
      } else merged.set(key, { purchase: obligation.purchase, lines: [...obligation.lines] })
    }
    return { orderId, obligations: [...merged.values()] }
  })
}
interface Demand {
  orderId: string; lineId: string; sku: string
  needed: InstanceType<typeof Quantity>; committed: InstanceType<typeof Quantity>; draft: InstanceType<typeof Quantity>; purchased: InstanceType<typeof Quantity>
  groups: Map<string, PurchaseObligation>
}
function header(row: Fact): PurchaseHeader {
  const channel = text(row.hzkj_purchase_channel), number = text(row.hzkj_1688_order_n), offline = channel === '2'
  const alibaba = !offline && (!!number || channel === '1' && row.hasAlibabaOffer === true)
  const state = text(row.hzkj_pay_status), payable = text(row.hzkj_paystatus), supplier = row.hzkj_supplier == null ? {} : fact(row.hzkj_supplier)
  return validatedPurchaseHeader({ id: identifier(row.id), number: text(row.billno), supplier: { id: text(supplier.id), name: text(supplier.name) || '—' },
    purchaseType: offline ? 'offline' : alibaba || channel === '1' ? 'online' : 'unknown', platform: alibaba ? '1688' : null,
    platformOrderNumber: !offline && number ? number : null,
    payment: state === '4' ? 'partially_refunded' : state === '3' ? 'refunded' : payable === 'C' || alibaba && state === '1' ? 'paid'
      : payable === 'B' ? 'partial' : payable === 'A' || alibaba && state === '0' ? 'unpaid' : 'unknown',
    placement: alibaba ? number ? 'placed' : 'pending' : 'unknown', paidAt: timestamp(row.hzkj_pay_time) }, true)
}
