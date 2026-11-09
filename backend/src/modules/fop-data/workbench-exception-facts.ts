import type { FopExceptionType } from './fop-data.types'
import { at, effectiveDispatches, latestDispatches, identifier, quantity, Quantity, stockBalance, rows, text, type Fact, type WorkbenchOrder } from './workbench-facts'

/** 异常依据当前事实判断。待处理、待尾程和历史通知不等同于失败；未知首次发生时间不借用创建时间。 */
export function appendExceptionFacts(item: WorkbenchOrder, data: Fact): void {
  const reasons = new Set<string>(), types = new Set<FopExceptionType>(), affected = new Set<string>()
  const add = (type: FopExceptionType, reason: string) => { types.add(type); reasons.add(reason) }
  if (item.raw.hzkj_addr_check_status === 'C') add('address_exception', '地址校验失败，待业务员核验')
  const allocations = rows(data, 'allocations', true).filter(doc => text(doc.hzkj_order_id) === item.order.id
    && !text(doc.hzkj_idem_key).startsWith('RMA:') && ['A', 'B', 'C'].includes(text(doc.billstatus))
    && ['pending', 'available', 'completed', 'error'].includes(text(doc.hzkj_alloc_status)))
  for (const doc of allocations) {
    if (doc.hzkj_alloc_status === 'error') add('allocation_exception', text(doc.hzkj_error_msg) || '配货异常：' + text(doc.hzkj_error_code))
  }
  if (new Set(allocations.map(doc => text(doc.hzkj_pkg_no))).size !== allocations.length) throw new Error('Ambiguous exception allocation package')
  const dispatches = effectiveDispatches(data, item), sent = outbound(item, data, dispatches)
  const demand = new Map<string, { needed: InstanceType<typeof Quantity>; owned: InstanceType<typeof Quantity>; common: InstanceType<typeof Quantity>; shipped: InstanceType<typeof Quantity>; sku: string }>()
  const sourcePackages = new Set<string>()
  for (const doc of allocations) for (const line of rows(doc, 'hzkj_alloc_entry', true)) {
    const source = item.lines.find(row => text(row.id) === text(line.hzkj_src_entry_number))
      ?? item.lines.find(row => text(row.seq) === text(line.hzkj_src_entry_number))
    if (!source || text(at(source, 'hzkj_local_sku.number')) !== text(at(line, 'hzkj_sku.number'))) throw new Error('Unresolved exception allocation source')
    const sourceKey = text(doc.hzkj_pkg_no) + ':' + identifier(source.id)
    if (sourcePackages.has(sourceKey)) throw new Error('Duplicate exception allocation source')
    sourcePackages.add(sourceKey)
    const shipped = sent.get(sourceKey) ?? new Quantity(0), remaining = Quantity.max(0, quantity(line.hzkj_req_qty).minus(shipped))
    const skuId = identifier(at(line, 'hzkj_sku.id')), current = demand.get(skuId) ?? { needed: new Quantity(0), owned: new Quantity(0), common: new Quantity(0), shipped: new Quantity(0), sku: text(at(line, 'hzkj_sku.number')) }
    current.needed = current.needed.plus(remaining)
    current.owned = current.owned.plus(quantity(line.hzkj_cust_occ_qty, true)); current.common = current.common.plus(quantity(line.hzkj_common_occ_qty, true))
    current.shipped = current.shipped.plus(shipped)
    demand.set(skuId, current)
  }
  const poolRows = rows(data, 'inventoryPools', true), pools = new Map(poolRows.map(pool => [text(pool.id), pool]))
  if (pools.size !== poolRows.length) throw new Error('Duplicate exception inventory pool')
  const materials = new Map<string, { needed: InstanceType<typeof Quantity>; owned: InstanceType<typeof Quantity>; common: InstanceType<typeof Quantity>; balance: InstanceType<typeof Quantity>; shared: InstanceType<typeof Quantity>; skus: string[] }>()
  for (const [skuId, current] of demand) {
    const prefix = skuId + ':' + identifier(at(item.raw, 'hzkj_dst_warehouse.id')) + ':'
    const owned = pools.get(prefix + identifier(at(item.raw, 'hzkj_customer.id'))), common = pools.get(prefix + '0')
    if (!owned || !common) throw new Error('Incomplete exception inventory facts')
    const material = identifier(owned.materialId)
    if (identifier(common.materialId) !== material) throw new Error('Inventory material mismatch')
    const balance = stockBalance(owned.onHand).minus(quantity(owned.occupied)), shared = stockBalance(common.onHand).minus(quantity(common.occupied))
    const aggregate = materials.get(material) ?? { needed: new Quantity(0), owned: new Quantity(0), common: new Quantity(0), balance, shared, skus: [] }
    if (!aggregate.balance.eq(balance) || !aggregate.shared.eq(shared)) throw new Error('Inconsistent material balance')
    // 与FOP出库占用迁移一致：客户池先释放，再释放公共池；单据字段保存原始占用，不能直接全额加回。
    const releasedOwned = Quantity.min(current.shipped, current.owned), releasedCommon = Quantity.min(Quantity.max(0, current.shipped.minus(releasedOwned)), current.common)
    aggregate.needed = aggregate.needed.plus(current.needed); aggregate.owned = aggregate.owned.plus(current.owned.minus(releasedOwned)); aggregate.common = aggregate.common.plus(current.common.minus(releasedCommon))
    if (current.needed.gt(0)) aggregate.skus.push(current.sku)
    materials.set(material, aggregate)
  }
  for (const aggregate of materials.values()) {
    const available = Quantity.max(0, aggregate.balance.plus(aggregate.owned)).plus(Quantity.max(0, aggregate.shared.plus(aggregate.common)))
    if (available.lt(aggregate.needed)) { add('stock_exception', '库存不足'); aggregate.skus.forEach(sku => affected.add(sku)) }
  }
  for (const doc of latestDispatches(data, item).values()) {
    const state = text(doc.hzkj_delivery_status), checkpoint = doc.checkpoint && typeof doc.checkpoint === 'object' ? doc.checkpoint as Fact : null
    if (state === 'SYNC_FAILED' || ['SYNC_UNKNOWN', 'PLATFORM_DONE'].includes(state) && checkpoint && text(checkpoint.failureStage)) {
      add('dispatch_exception', '发运处理失败' + (checkpoint && text(checkpoint.failureStage) ? '：' + text(checkpoint.failureStage) : ''))
    }
    const node = rows(doc, 'hzkj_logisticstrackentry')[0]
    if (node && trackingException(text(node.hzkj_track_node_code))) add('logistics_exception', '物流轨迹异常：' + (text(node.hzkj_track_node_descripti) || text(node.hzkj_track_node_code)))
  }
  item.order.exception = types.size ? { type: [...types][0], types: [...types], reason: [...reasons].join('；'), hours: null,
    affectedSkus: affected.size ? [...affected] : item.order.items.map(line => line.sku).filter(Boolean) } : null
}
function outbound(item: WorkbenchOrder, data: Fact, dispatches: Fact[]) {
  const byDispatch = new Map(dispatches.filter(doc => text(doc.hzkj_delivery_status).toUpperCase() !== 'CANCELLED').map(doc => [text(doc.billno), text(doc.hzkj_src_package)]))
  const byNotice = new Map(rows(data, 'deliveryNotices', true).filter(notice => byDispatch.has(text(notice.hzkj_deliver_billno)))
    .map(notice => [text(notice.billno), byDispatch.get(text(notice.hzkj_deliver_billno))!]))
  const result = new Map<string, InstanceType<typeof Quantity>>()
  for (const bill of rows(data, 'outbounds', true)) {
    if (bill.billstatus !== 'C' || text(at(bill, 'biztype.number')) === '2101') continue
    for (const line of rows(bill, 'billentry', true)) {
      const packageNo = byNotice.get(text(line.srcbillnumber))
      if (!packageNo || text(line.hzkj_entry_billno) !== item.order.orderNumber) continue
      const key = packageNo + ':' + identifier(line.sourceEntryId)
      result.set(key, (result.get(key) ?? new Quantity(0)).plus(quantity(line.qty)))
    }
  }
  return result
}
/** 与FOP轨迹任务已确认的异常/成功代码保持一致，不用“没有物流号”推断失败。 */
function trackingException(code: string) {
  const value = code.toUpperCase()
  if (['DELIVERED', 'LASTMILEDELIVERED', 'LM40', 'DSD', '40', 'FPX_S_OK', 'FPX_S_OKGP', 'FPX_S_OKVP', 'FPX_S_OKCC', 'FPX_S_OKSC', 'FPX_S_OKIDC'].includes(value) || value.startsWith('DELIVERED_')) return false
  return ['DELIVERYFAILED', 'LASTMILEDELIVERYFAILED', 'LASTMILEDELIVERYTRIED', 'LASTMILELOST', 'LASTMILEDAMAGE', 'LASTMILEPAYMENTISSUE',
    'LM35', 'LM50', 'LM54', 'LM56', 'LM60', 'LM70', 'LM75', 'LM85', 'LM90', 'DDF', 'DDE', 'OCE', 'DRS', 'PARCELLOST', 'RETURNED', 'EXCEPTION'].includes(value)
    || ['PARCELRETURN_', 'DELIVERYFAIL_', 'CLEARANCEFAILED_', 'FPX_D_DD', 'FPX_D_SH', 'FPX_D_FD', 'FPX_D_VN', 'FPX_D_RA', 'FPX_I_DG', 'FPX_I_HC', 'FPX_Y_CCMC', 'FPX_Y_CCSC', 'FPX_Y_DS', 'FPX_Y_ADPR'].some(prefix => value.startsWith(prefix))
}
