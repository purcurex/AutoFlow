import type { FopOrder } from './fop-data.types'
import type { BusinessScope } from '../users/business-scope'
import type { FopPermissionGrant } from './fop-data.types'
import { buildPurchaseReturns, filterPurchaseReturns, groupPurchaseReturnOrders, summarizePurchaseReturnOrders, type PurchaseReturnSource } from './purchase-returns'
const identity = { tenantId: 't1', userId: 'u1' }
const grant = { subject: identity, allowedOrderIds: ['a', 'b'], allowedPurchaseOrderIds: ['p1'], allowedPurchaseReturnIds: ['r1', 'r2', 'r3'] }
const line = (id: string, owner = 'alice', extra = {}) => ({ id, sku: id, name: `Product ${id}`, variant: '', imageUrl: null, quantity: 5, returnedQuantity: 2, sourceOrder: { id: id === 'x' ? 'hidden' : id, number: `SO-${id}`, kind: 'fulfillment', customerName: 'Customer', owner: { id: owner, name: owner }, department: { id: 'd1', name: '业务一部' } }, ...extra })
const physical = (id: string, extra = {}) => ({ id, tenantId: 't1', kind: 'physical_return', number: `TH-${id}`, status: 'pending_outbound', purchaseOrder: { id: 'p1', number: 'CG-1' }, supplier: { id: 's1', name: 'Supplier' }, warehouseCode: 'HZ', warehouse: '杭州仓', createdAt: '2026-11-01T00:00:00Z', logistics: { carrier: '顺丰', trackingNumber: '001234567890123456789' }, lines: [line('a'), line('b', 'bob')], ...extra })
const build = (data: unknown, permission: FopPermissionGrant, scope: BusinessScope) => buildPurchaseReturns(data, permission, scope, [line('a').sourceOrder, line('b', 'bob').sourceOrder] as PurchaseReturnSource[])
const scope = { role: 'salesperson' as const, employeeId: 'alice', departmentId: 'd1' }
const snapshot = (...returns: unknown[]) => ({ subject: identity, returns })
describe('physical purchase return read model', () => {
  it('intersects independent return, purchase and source grants with employee scope before totaling', () => {
    const rows = build(snapshot(physical('r1'), physical('secret'), physical('r2', { kind: 'refund_only' }), physical('r3', { tenantId: 'other' })), grant, scope)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'r1', quantity: 5, returnedQuantity: 2, lines: [{ id: 'a', sourceOrder: { id: 'a' } }] })
    expect(JSON.stringify(rows)).not.toContain('bob')
    expect(build(snapshot(physical('r1')), { ...grant, allowedPurchaseReturnIds: [] }, scope)).toEqual([])
    expect(build(snapshot(physical('r1')), { ...grant, allowedPurchaseOrderIds: [] }, scope)).toEqual([])
  })
  it('rejects wrong subjects and malformed authorized quantities without guessing return progress', () => {
    expect(() => build({ subject: { ...identity, userId: 'other' }, returns: [] }, grant, scope)).toThrow()
    expect(() => build(snapshot(physical('r1', { lines: [line('a', 'alice', { returnedQuantity: 6 })] })), grant, scope)).toThrow()
    const rows = build(snapshot(physical('r1', { status: 'unmapped' })), grant, scope)
    expect(rows[0].status).toBe('unknown')
  })
  it('rejects IDs that become duplicate after normalization instead of doubling quantities', () => {
    expect(() => build(snapshot(physical('r1', { lines: [line('a'), line('a', 'alice', { id: ' a ' })] })), grant, scope)).toThrow()
  })
  it('filters source lines before counting quantities and never searches inaccessible source text', () => {
    const rows = build(snapshot(physical('r1')), grant, { ...scope, role: 'admin' })
    expect(filterPurchaseReturns(rows, { ownerId: 'alice' })[0]).toMatchObject({ quantity: 5, returnedQuantity: 2, lines: [{ id: 'a' }] })
    expect(filterPurchaseReturns(build(snapshot(physical('r1')), grant, scope), { search: 'bob' })).toEqual([])
    expect(filterPurchaseReturns(rows, { status: 'completed' })).toEqual([])
    expect(filterPurchaseReturns(rows, { warehouseCode: 'SZ' })).toEqual([])
  })
})

describe('fulfillment-primary purchase return grouping', () => {
  const sourceOrders = [
    { id: 'a', orderNumber: 'SO-A', customerName: 'Customer A', storeName: 'A store', items: [{ sku: 'SKU-A', name: 'A product', quantity: 2 }], amount: 10, currency: 'USD', paidAt: '2026-10-01T00:00:00Z' },
    { id: 'b', orderNumber: 'SO-B', customerName: 'Customer B', storeName: 'B store', items: [{ sku: 'SKU-B', name: 'B product', quantity: 3 }], amount: 20, currency: 'USD', paidAt: null },
  ] as FopOrder[]
  it('keeps each source allocation under its order and counts shared bills and order amounts once', () => {
    const docs = build(snapshot(physical('r1'), physical('r2', { number: null, lines: [line('a')] })), grant, { ...scope, role: 'admin' })
    const rows = groupPurchaseReturnOrders(docs, sourceOrders, {})
    expect(rows.map(row => [row.orderNumber, row.returnQuantity, row.purchaseReturns.length])).toEqual([['SO-A', 10, 2], ['SO-B', 5, 1]])
    expect(summarizePurchaseReturnOrders(rows)).toMatchObject({ orderCount: 2, returnCount: 1, quantity: 15, amountsByCurrency: [{ currency: 'USD', amount: 30 }] })
    expect(rows[0].purchaseReturns[0].lines.map(line => line.sourceOrder.id)).toEqual(['a'])
    expect(rows[0].purchaseReturns[1].number).toBeNull()
  })
  it('matches a SKU at fulfillment-order level without trimming other products or linked return facts', () => {
    const orders = [{ ...sourceOrders[0], items: [{ sku: 'SKU-A', name: 'A', quantity: 2 }, { sku: 'SKU-C', name: 'C', quantity: 3 }] }, sourceOrders[1]] as FopOrder[]
    const docs = build(snapshot(physical('r1'), physical('r2', { lines: [line('a', 'alice', { sku: 'SKU-C' })] })), grant, { ...scope, role: 'admin' })
    const rows = groupPurchaseReturnOrders(docs, orders, { search: 'sku-a' })
    expect(rows.map(row => row.orderNumber)).toEqual(['SO-A'])
    expect(rows[0].items.map(item => [item.sku, item.quantity])).toEqual([['SKU-A', 2], ['SKU-C', 3]])
    expect(rows[0].purchaseReturns.map(document => document.id)).toEqual(['r1', 'r2'])
    expect(summarizePurchaseReturnOrders(rows)).toMatchObject({ orderCount: 1, itemQuantity: 5, amountsByCurrency: [{ currency: 'USD', amount: 10 }] })
  })
  it('uses primary order fields for search and leaves unknown payment dates last in both directions', () => {
    const docs = build(snapshot(physical('r1')), grant, { ...scope, role: 'admin' })
    expect(groupPurchaseReturnOrders(docs, sourceOrders, { search: 'B store' }).map(row => row.id)).toEqual(['b'])
    expect(groupPurchaseReturnOrders(docs, sourceOrders, { paidAtOrder: 'desc' }).map(row => row.id)).toEqual(['a', 'b'])
  })
})
