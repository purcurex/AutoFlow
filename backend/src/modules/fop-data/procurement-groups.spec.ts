import { buildPurchaseGroups, purchaseGroupTotals } from './procurement-groups'
import type { PurchaseLinkSnapshot, PurchaseHeader } from './procurement-groups.types'
import type { FopOrder } from './fop-data.types'
const subject = { tenantId: 't', userId: 'u' }
const order = (id: string, extra = {}): FopOrder => ({ id, orderNumber: id, customerName: id, storeName: 'Store', shopifyOrderNumber: '#1', items: [{ sku: 'A', name: 'Alpha', imageUrl: null, variant: '', quantity: 10 }, { sku: 'B', name: 'Beta', imageUrl: null, variant: '', quantity: 5 }], owner: { id, name: id }, department: { id: 'd', name: 'Dept' }, warehouseCode: 'HZ', warehouse: 'HZ', paymentStatus: 'paid', cancelled: false, paidAt: '2026-10-01T00:00:00Z', ...extra } as FopOrder)
const header = (id: string, payment: PurchaseHeader['payment'] = 'paid'): PurchaseHeader => ({ id, number: id, supplier: { id: 's', name: 'Supplier' }, purchaseType: 'online', platform: '1688', platformOrderNumber: null, payment, placement: 'placed', paidAt: payment === 'paid' ? '2026-10-02T00:00:00Z' : null })
const link = (id: string, sku = 'A', payment: PurchaseHeader['payment'] = 'paid') => ({ purchase: header(id, payment), lines: [{ fulfillmentLineId: sku, purchaseLineId: `${id}-${sku}`, sku, quantity: 5, shippedQuantity: 1 }] })
const snapshot = (): PurchaseLinkSnapshot => ({ subject, orders: [{ orderId: 'o1', obligations: [link('p1'), link('p2', 'B', 'unpaid')] }, { orderId: 'o2', obligations: [link('p1')] }] })
const run = (s = snapshot(), orders = [order('o1'), order('o2')], allowed = ['p1', 'p2'], queue: 'procurement' | 'procurement_shipping' = 'procurement_shipping', search?: string) => buildPurchaseGroups(orders, new Map(), { subject, allowedOrderIds: orders.map(o => o.id), allowedPurchaseOrderIds: allowed }, s, { queue, search })
it('merges purchases across orders, splits one order across queues, and counts only linked quantities', () => {
  const groups = run(); expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ id: 'purchase:p1', orderCount: 2, skuCount: 1, quantity: 10, shippedQuantity: 2, pendingQuantity: 8 })
  expect(groups[0].rows[0].lines.map(l => l.sku)).toEqual(['A'])
  expect(run(snapshot(), undefined, undefined, 'procurement')[0].rows.map(r => r.orderId)).toEqual(['o1'])
  expect(purchaseGroupTotals([...groups, ...run(snapshot(), undefined, undefined, 'procurement')])).toMatchObject({ purchaseCount: 2, orderCount: 2 })
})
it('同采购单已发完一行、另一行尚未发时按部分发货计算', () => {
  const s: PurchaseLinkSnapshot = { subject, orders: [{ orderId: 'o1', obligations: [{ purchase: header('p1'), lines: [
    { fulfillmentLineId: 'A', purchaseLineId: 'p1-A', sku: 'A', quantity: 5, shippedQuantity: 5 },
    { fulfillmentLineId: 'B', purchaseLineId: 'p1-B', sku: 'B', quantity: 5, shippedQuantity: 0 },
  ] }] }] }
  expect(run(s, [order('o1')])[0]).toMatchObject({ shipment: 'partial', quantity: 10, shippedQuantity: 5, pendingQuantity: 5 })
})
it('never leaks siblings or an independently denied purchase, and filters before group totals', () => {
  expect(run(snapshot(), [order('o1')])[0]).toMatchObject({ orderCount: 1, quantity: 5 })
  expect(JSON.stringify(run(snapshot(), [order('o1')]))).not.toContain('o2')
  expect(run(snapshot(), undefined, [])).toEqual([])
  expect(run(snapshot(), undefined, undefined, 'procurement_shipping', 'o1')[0].orderCount).toBe(1)
  expect(run(snapshot(), undefined, undefined, 'procurement_shipping', 'p1')[0].orderCount).toBe(2)
  expect(run(snapshot(), undefined, undefined, 'procurement_shipping', 'B')).toEqual([])
})
it('金蝶相同SKU按履约行校验上限和商品描述，另一行的数量不能覆盖本行', () => {
  const items = ['first', 'second'].map((id, i) => ({ id, name: id, sku: 'same', quantity: i + 1, imageUrl: null, variant: '' }))
  const lines = [{ fulfillmentLineId: 'first', sku: 'same', purchaseLineId: null, shippedQuantity: 0, quantity: 1 }]
  const s: PurchaseLinkSnapshot = { subject, exactSourceLines: true, orders: [{ orderId: 'o1', obligations: [{ purchase: null, lines }] }] }
  expect(run(s, [order('o1', { items })], [], 'procurement')[0].rows[0].lines[0].name).toBe('first')
  lines[0].quantity = 2
  expect(() => run(s, [order('o1', { items })], [], 'procurement')).toThrow('Source purchase exceeds')
})
it('keeps explicit uncreated procurement but rejects incomplete linkage as an integration failure', () => {
  const s: PurchaseLinkSnapshot = { subject, orders: [{ orderId: 'o1', obligations: [{ purchase: null, lines: [{ fulfillmentLineId: 'A', purchaseLineId: null, sku: 'A', quantity: 4, shippedQuantity: 0 }] }] }, { orderId: 'o2', obligations: null }, { orderId: 'o3', obligations: [] }] }
  expect(() => run(s, [order('o1'), order('o2'), order('o3')], [], 'procurement')).toThrow('Incomplete purchase linkage')
  s.orders[1].obligations = []
  const groups = run(s, [order('o1'), order('o2'), order('o3')], [], 'procurement')
  expect(groups.map(g => g.kind)).toEqual(['uncreated'])
  expect(purchaseGroupTotals(groups)).not.toHaveProperty('unknownCount')
})
it.each([
  ['offline', null], ['online', '1688'], ['online', 'other'],
] as const)('retains explicit purchase channel %s / %s without inferring from platform order number', (purchaseType, platform) => {
  const s = snapshot()
  s.orders.forEach(o => o.obligations!.forEach(o => { o.purchase = { ...o.purchase!, purchaseType, platform } }))
  expect(run(s)[0].purchase).toMatchObject({ purchaseType, platform })
})
it('rejects missing or contradictory purchase classification', () => {
  for (const fields of [{ purchaseType: undefined }, { purchaseType: 'offline', platform: '1688' }, { purchaseType: 'unknown', platform: '1688' }]) {
    const s = snapshot(); Object.assign(s.orders[0].obligations![0].purchase!, fields)
    expect(() => run(s)).toThrow('Invalid purchase channel')
  }
})
it('fails closed on incomplete/mismatched/duplicate snapshots, invalid quantities or inconsistent shared headers', () => {
  expect(() => run({ ...snapshot(), subject: { ...subject, userId: 'other' } })).toThrow()
  expect(() => run({ subject, orders: [] })).toThrow()
  const bad = snapshot(); bad.orders[0].obligations![0].lines[0].shippedQuantity = 8
  expect(() => run(bad)).toThrow()
  const duplicate = snapshot(); duplicate.orders.push(duplicate.orders[0]); expect(() => run(duplicate)).toThrow()
  const inconsistent = snapshot(); inconsistent.orders[1].obligations![0].purchase!.supplier.name = 'Different'; expect(() => run(inconsistent)).toThrow()
})

import { demoPurchaseLinks } from './procurement-groups-demo'
import { demoSupplierFollowUps } from './supplier-follow-up-demo'
import { buildPurchaseGroupWorkbook } from './procurement-groups-export'
import * as ExcelJS from 'exceljs'
it('keeps Demo supplier follow-up IDs and pending quantities consistent with purchase linkage', () => {
  const o: any = { ...order('o1'), tenantId: 't', createdAt: '2026-10-02T00:00:00Z', procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'partial', alibabaOrder: 'pushed' }, fulfillmentProgress: { supplierShipment: 'partial' } }
  const obligation = demoPurchaseLinks(subject, [o]).orders[0].obligations!.find(o => o.purchase?.payment === 'paid')!
  const followUp = demoSupplierFollowUps(o).find(c => c.purchaseOrderId === obligation.purchase!.id)
  expect(followUp).toBeDefined()
  expect(followUp!.lines[0].pendingQuantity).toBe(obligation.lines[0].quantity - obligation.lines[0].shippedQuantity!)
})
it('sorts unknown receipt last in both directions and keeps export strings literal and channel columns explicit', async () => {
  const s: PurchaseLinkSnapshot = { subject, orders: [{ orderId: 'o1', obligations: [link('p1', 'A', 'unpaid')] }, { orderId: 'o2', obligations: [link('p2', 'B', 'unpaid')] }] }
  const orders = [order('o1', { orderNumber: '=CMD()', paidAt: '2026-10-03T00:00:00Z' }), order('o2', { paidAt: null })]
  for (const sortOrder of ['asc', 'desc'] as const) {
    const groups = buildPurchaseGroups(orders, new Map(), { subject, allowedOrderIds: ['o1', 'o2'], allowedPurchaseOrderIds: ['p1', 'p2'] }, s, { queue: 'procurement', sortOrder })
    expect(groups.map(g => g.id)).toEqual(['purchase:p1', 'purchase:p2'])
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildPurchaseGroupWorkbook(groups) as any)
    const sheet = book.getWorksheet('采购关联明细')!
    expect(sheet.getCell('F2').value).toBe('=CMD()'); expect(sheet.getCell('F2').type).toBe(ExcelJS.ValueType.String)
    expect(sheet.getCell('R1').value).toBe('采购类型'); expect(sheet.getCell('R2').value).toBe('线上'); expect(sheet.getCell('S2').value).toBe('1688'); expect(sheet.getCell('C1').value).toBe('平台订单号')
  }
})

it('merges every uncreated obligation into one group with one row per fulfillment order', () => {
  const pending = (sku: string) => ({ purchase: null, lines: [{ fulfillmentLineId: sku, purchaseLineId: null, sku, quantity: 2, shippedQuantity: 0 }] })
  const s: PurchaseLinkSnapshot = { subject, orders: [{ orderId: 'o1', obligations: [pending('A'), pending('B')] }, { orderId: 'o2', obligations: [pending('A')] }] }
  const groups = run(s, undefined, [], 'procurement')
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ id: 'uncreated', orderCount: 2, skuCount: 2, quantity: 6 })
  expect(groups[0].rows[0].lines).toHaveLength(2)
  expect(purchaseGroupTotals(groups).uncreatedCount).toBe(2)
  expect(run(s, undefined, [], 'procurement', 'o2')[0]).toMatchObject({ id: 'uncreated', orderCount: 1, quantity: 2 })
  expect(run(s, undefined, [], 'procurement_shipping')).toEqual([])
  s.orders[0].obligations!.push(pending('A'))
  expect(() => run(s, undefined, [], 'procurement')).toThrow('Invalid purchase source quantities')
})

it('pins uncreated demand before purchases in either receipt sort direction', () => {
  const s: PurchaseLinkSnapshot = { subject, orders: [
    { orderId: 'old', obligations: [link('old-purchase', 'A', 'unpaid')] },
    { orderId: 'pending', obligations: [{ purchase: null, lines: [{ fulfillmentLineId: 'A', purchaseLineId: null, sku: 'A', quantity: 1, shippedQuantity: 0 }] }] },
    { orderId: 'new', obligations: [link('new-purchase', 'A', 'unpaid')] },
  ] }
  const orders = [order('old', { paidAt: '2026-10-01T00:00:00Z' }), order('pending', { paidAt: null }), order('new', { paidAt: '2026-10-20T00:00:00Z' })]
  for (const sortOrder of ['asc', 'desc'] as const) {
    const groups = buildPurchaseGroups(orders, new Map(), { subject, allowedOrderIds: orders.map(o => o.id), allowedPurchaseOrderIds: ['old-purchase', 'new-purchase'] }, s, { queue: 'procurement', sortOrder })
    expect(groups.map(g => g.id)).toEqual(['uncreated', ...(sortOrder === 'asc' ? ['purchase:old-purchase', 'purchase:new-purchase'] : ['purchase:new-purchase', 'purchase:old-purchase'])])
  }
})
it('filters current purchase progress before totals and retains platform-neutral placement semantics', () => {
  const orders = ['uncreated', 'placement', 'payment', 'refund', 'partial', 'unknown'].map(id => order(id))
  const s: PurchaseLinkSnapshot = { subject, orders: orders.map(o => ({ orderId: o.id, obligations: [{ purchase: o.id === 'uncreated' ? null : {
    ...header(o.id, o.id === 'refund' ? 'refunded' : o.id === 'partial' ? 'partial' : o.id === 'unknown' ? 'unknown' : 'unpaid'),
    purchaseType: 'offline', platform: null, placement: o.id === 'placement' || o.id === 'refund' ? 'pending' : 'placed',
  }, lines: [{ fulfillmentLineId: 'A', purchaseLineId: o.id === 'uncreated' ? null : 'p-A', sku: 'A', quantity: 2, shippedQuantity: 0 }] }] })) }
  for (const [purchaseStage, ids] of [['uncreated', ['uncreated']], ['placement_pending', ['purchase:placement']], ['payment_pending', ['purchase:partial', 'purchase:payment']], ['refund_pending', ['purchase:refund']]] as const) {
    const groups = buildPurchaseGroups(orders, new Map(), { subject, allowedOrderIds: orders.map(o => o.id), allowedPurchaseOrderIds: orders.map(o => o.id) }, s, { queue: 'procurement', purchaseStage })
    expect(groups.map(g => g.id)).toEqual(ids)
    expect(purchaseGroupTotals(groups).orderCount).toBe(ids.length)
  }
})

it('filters completed purchase groups by actual completion time, retaining only fully completed authorized orders', () => {
  const recent = new Date(Date.now() - 2 * 86400000).toISOString(), old = new Date(Date.now() - 40 * 86400000).toISOString()
  const facts = { reviewStatus: 'approved', procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder: 'pushed' }, fulfillmentProgress: { shopifySync: 'synced' } }
  const rows = [order('o1', { ...facts, procurementCompletedAt: recent }), order('o2', { ...facts, procurementCompletedAt: old })]
  const links = snapshot(); links.orders[0].obligations = [link('p1')]
  const grant = { subject, allowedOrderIds: ['o1', 'o2'], allowedPurchaseOrderIds: ['p1'] }
  const groups = buildPurchaseGroups(rows, new Map(), grant, links, { queue: 'procurement', completed: true })
  expect(groups).toHaveLength(1)
  expect(groups[0].rows.map(row => row.orderId)).toEqual(['o1'])
  expect(groups[0].completedAt).toBe(recent)
  const quarter = buildPurchaseGroups(rows, new Map(), grant, links, { queue: 'procurement', completed: true, timeRange: '3m' })
  expect(quarter[0].rows.map(row => row.orderId)).toEqual(['o1', 'o2'])
  expect(buildPurchaseGroups(rows, new Map(), { ...grant, allowedPurchaseOrderIds: [] }, links, { queue: 'procurement', completed: true })).toEqual([])
})


it('已付款线下采购进入待发货，数量未知且退出待采购', () => {
  const s = snapshot()
  s.orders = [s.orders[0]]
  s.orders[0].obligations = [s.orders[0].obligations![0]]
  Object.assign(s.orders[0].obligations[0].purchase!, { purchaseType: 'offline', platform: null, platformOrderNumber: null, placement: 'unknown' })
  s.orders[0].obligations[0].lines[0].shippedQuantity = null
  expect(run(s, [order('o1')])).toEqual([expect.objectContaining({ shipment: 'unknown', shippedQuantity: null, pendingQuantity: null })])
  expect(run(s, [order('o1')], undefined, 'procurement')).toEqual([])
})
it('已全部发货的线上采购移出待发货', () => {
  const s = snapshot()
  s.orders.forEach(order => order.obligations!.forEach(group => group.lines.forEach(line => { line.shippedQuantity = line.quantity })))
  expect(run(s)).toEqual([])
})
