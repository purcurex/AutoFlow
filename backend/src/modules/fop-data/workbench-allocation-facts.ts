import type { AllocationQueryIssue, FopOrder } from './fop-data.types'
import { completedRange } from './completed-orders'
import { at, documentStatus, effectiveDispatches, identifier, quantity, Quantity, rows, text, timestamp, type Fact, type WorkbenchOrder } from './workbench-facts'

/** 配货阶段、分批出库数量、完成时刻与最终商品投影均在AutoFlow计算。来源匹配只消费Java确认的行ID。 */
export function allocationFacts(item: WorkbenchOrder, data: Fact, queue: string, completed: boolean, timeRange?: '1w' | '1m' | '3m'): FopOrder | null {
  if (item.order.paymentStatus !== 'paid' || item.order.reviewStatus !== 'approved') return null
  const candidates = rows(data, 'allocations', true).filter(doc => text(doc.hzkj_order_id) === item.order.id
    && !text(doc.hzkj_idem_key).startsWith('RMA:') && ['A', 'B', 'C'].includes(text(doc.billstatus))
    && ['pending', 'available', 'completed'].includes(text(doc.hzkj_alloc_status)))
  const stage = (doc: Fact) => queue === 'shipping' ? doc.billstatus === 'C' && doc.hzkj_alloc_status === 'completed'
    : doc.billstatus !== 'C' && (queue === 'allocation_review' ? doc.hzkj_alloc_status === 'completed' : ['pending', 'available'].includes(text(doc.hzkj_alloc_status)))
  const selectedPackages = new Set(candidates.filter(stage).map(doc => text(doc.hzkj_pkg_no)))
  const selected = candidates.filter(doc => selectedPackages.has(text(doc.hzkj_pkg_no)))
  if (!selected.length) return null
  const seen = new Set<string>(), sourceQuantities = new Map<string, InstanceType<typeof Quantity>>()
  const diagnostics: AllocationQueryIssue[] = [], documents: NonNullable<FopOrder['allocationDocuments']> = [], dispatchDocuments = new Map<string, NonNullable<FopOrder['dispatchDocuments']>[number]>()
  const dispatches = effectiveDispatches(data, item).filter(doc => text(doc.hzkj_delivery_status).toUpperCase() !== 'CANCELLED' && text(doc.hzkj_fulfillment_status).toLowerCase() !== 'cancelled')
  const notices = rows(data, 'deliveryNotices', true), outbounds = rows(data, 'outbounds', true)
  const inRange = completedRange(timeRange)
  let partial = false
  for (const doc of selected) {
    const packageNo = text(doc.hzkj_pkg_no), id = identifier(doc.id)
    if (!packageNo || seen.has(packageNo)) throw new Error('Ambiguous allocation package')
    seen.add(packageNo)
    if (text(doc.hzkj_order_no) !== item.order.orderNumber || text(at(doc, 'hzkj_warehouse.id')) !== text(at(item.raw, 'hzkj_dst_warehouse.id'))) throw new Error('Allocation source dimensions mismatch')
    const required = new Map<string, InstanceType<typeof Quantity>>()
    for (const line of rows(doc, 'hzkj_alloc_entry', true)) {
      const reference = text(line.hzkj_src_entry_number), sku = text(at(line, 'hzkj_sku.number'))
      let sources = item.lines.filter(source => text(source.id) === reference)
      if (!sources.length) sources = item.lines.filter(source => text(source.seq) === reference)
      const orderSku = sources.length === 1 ? text(at(sources[0], 'hzkj_local_sku.number')) : null
      if (sources.length !== 1 || !sku || orderSku !== sku) {
        diagnostics.push({ code: sources.length === 1 && sku && orderSku ? 'ALLOCATION_SKU_MISMATCH' : 'ALLOCATION_SOURCE_UNRESOLVED',
          allocationId: id, allocationNumber: text(doc.billno), sourceEntryId: sources.length === 1 ? identifier(sources[0].id) : reference,
          allocationSku: sku, orderSku: sources.length === 1 && sku && orderSku ? orderSku : null })
        continue
      }
      const sourceId = identifier(sources[0].id), qty = quantity(line.hzkj_req_qty)
      if (qty.isZero()) continue
      if (required.has(sourceId)) throw new Error('Duplicate allocation source line')
      required.set(sourceId, qty)
    }
    const linked = dispatches.filter(bill => text(bill.hzkj_src_package) === packageNo), linkedNumbers = new Set(linked.map(bill => text(bill.billno)))
    const relatedNotices = notices.filter(notice => linkedNumbers.has(text(notice.hzkj_deliver_billno))), noticeNumbers = new Set(relatedNotices.map(notice => text(notice.billno)))
    const shipped = new Map<string, InstanceType<typeof Quantity>>(), auditEvents = new Map<string, { at: string | null; qty: InstanceType<typeof Quantity> }[]>()
    for (const bill of outbounds) {
      if (bill.billstatus !== 'C' || text(at(bill, 'biztype.number')) === '2101') continue
      for (const line of rows(bill, 'billentry', true)) {
        if (!noticeNumbers.has(text(line.srcbillnumber))) continue
        const sourceId = identifier(line.sourceEntryId)
        const original = item.lines.find(source => text(source.id) === sourceId)
        if (text(line.hzkj_entry_billno) !== item.order.orderNumber || !original || text(at(original, 'hzkj_local_sku.number')) !== text(at(line, 'hzkj_local_sku.number'))) throw new Error('Outbound source mismatch')
        const qty = quantity(line.qty)
        shipped.set(sourceId, (shipped.get(sourceId) ?? new Quantity(0)).plus(qty))
        if (qty.gt(0)) auditEvents.set(sourceId, [...(auditEvents.get(sourceId) ?? []), { at: timestamp(bill.auditdate), qty }])
      }
    }
    const fully = required.size > 0 && [...required].every(([source, qty]) => (shipped.get(source) ?? new Quantity(0)).gte(qty))
    if (completed !== fully) continue
    const completionTimes = [...required].map(([source, qty]) => {
      const events = auditEvents.get(source) ?? []
      if (!events.length || events.some(event => !event.at)) return null
      let total = new Quantity(0)
      for (const event of events.sort((a, b) => a.at!.localeCompare(b.at!))) { total = total.plus(event.qty); if (total.gte(qty)) return event.at }
      return null
    })
    const outboundCompletedAt = completed && completionTimes.length && completionTimes.every(Boolean) ? completionTimes.sort().slice(-1)[0]! : null
    if (completed && !inRange(outboundCompletedAt)) continue
    if (!required.size) { if (!diagnostics.length) throw new Error('Empty allocation demand'); continue }
    if (completed) documents.push({ id, number: text(doc.billno), packageNo, readyAt: timestamp(doc.hzkj_complete_time), wmsCreatedAt: latestWms(relatedNotices),
      dispatchComplete: linked.length > 0 && linked.every(bill => bill.billstatus === 'C'), outboundCompletedAt })
    else documents.push({ id, number: text(doc.billno), packageNo, readyAt: timestamp(doc.hzkj_complete_time), wmsCreatedAt: latestWms(relatedNotices),
      dispatchComplete: linked.length > 0 && linked.every(bill => bill.billstatus === 'C') })
    partial ||= [...required].some(([source]) => (shipped.get(source) ?? new Quantity(0)).gt(0))
    for (const [source, qty] of required) sourceQuantities.set(source, (sourceQuantities.get(source) ?? new Quantity(0)).plus(qty))
    for (const bill of linked) dispatchDocuments.set(identifier(bill.id), { id: identifier(bill.id), number: text(bill.billno), status: documentStatus(bill.billstatus) })
  }
  if (diagnostics.length) return { ...item.order, allocationIssues: diagnostics }
  if (!documents.length) return null
  const original = new Map(item.lines.map(line => [identifier(line.id), quantity(line.hzkj_qty, true)]))
  for (const [source, qty] of sourceQuantities) if (!original.has(source) || qty.gt(original.get(source)!)) throw new Error('Allocation exceeds source demand')
  const ready = queue !== 'allocation'
  return { ...item.order, items: item.order.items.filter(line => sourceQuantities.has(line.id!)).map(line => ({ ...line, quantity: sourceQuantities.get(line.id!)!.toNumber() })),
    allocationDocuments: documents, allocationDocument: documents.length === 1 ? documents[0] : null, allocationStatus: ready ? 'allocated' : 'not_ready',
    allocationReadyAt: documents.map(doc => doc.readyAt).filter((value): value is string => !!value).sort().slice(-1)[0] ?? null,
    wmsCreatedAt: documents.length === 1 ? documents[0].wmsCreatedAt : null, dispatchDocuments: [...dispatchDocuments.values()],
    dispatchDocumentsComplete: documents.every(doc => doc.dispatchComplete),
    ...(completed ? { outboundCompletedAt: documents.map(doc => doc.outboundCompletedAt!).sort().slice(-1)[0] ?? null } : {}),
    fulfillmentProgress: { ...item.order.fulfillmentProgress, allocationCreated: true, stockReadiness: ready ? 'ready' : 'incomplete', allocationReview: queue === 'shipping' ? 'approved' : 'pending',
      outbound: completed ? 'completed' : partial ? 'partial' : 'pending' } }
}
function latestWms(notices: Fact[]): string | null {
  return notices.filter(notice => notice.hzkj_is_push === '1').map(notice => timestamp(notice.hzkj_bill_create_time)).filter((value): value is string => !!value).sort().slice(-1)[0] ?? null
}
