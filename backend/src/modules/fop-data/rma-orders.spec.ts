import { buildRmaOrders, type RmaCaseCandidate } from './rma-orders'
import { demoRmaCases } from './rma-orders-demo'
import type { FopOrder, FopOrderCandidate } from './fop-data.types'
const subject = { tenantId: 't1', userId: 'u1' }
const grant = { subject, allowedOrderIds: ['o1'], allowedRmaCaseIds: ['a', 'b', 'c'] }
const order = { id: 'o1', orderNumber: 'SO-001', shopifyOrderNumber: '#001', customerName: 'Alice', storeName: 'Store', items: [{ sku: 'SKU', name: 'Product' }], amount: 20, currency: 'USD', cancelled: true, owner: { id: 'e1', name: 'Sales' }, department: { id: 'child', name: 'Child' } } as FopOrder
const flow = (id: string, extra = {}): RmaCaseCandidate => ({ id, orderId: 'o1', tenantId: 't1', type: 'refund', isOpen: true, number: `RMA-${id}`, reason: null, stage: null, requestedAmount: null, currency: null, createdAt: null, updatedAt: null, ...extra })
const paths = new Map([['o1', ['parent', 'child']]])
describe('RMA independent workflow read model', () => {
  it('defaults to active and groups cases by authorized order even if the order is cancelled', () => {
    const rows = buildRmaOrders({ subject, cases: [flow('a'), flow('b', { type: 'cancellation' }), flow('c', { isOpen: false })] }, grant, [order], {}, paths)
    expect(rows).toHaveLength(1); expect(rows[0].rmaCases.map(row => row.id)).toEqual(['a', 'b']); expect(rows[0].amount).toBe(20)
    expect(buildRmaOrders({ subject, cases: [flow('a')] }, grant, [order], { departmentId: 'parent' }, paths)).toHaveLength(1)
  })
  it.each(['refund', 'return_refund'] as const)('preserves full fulfillment products for %s without replacing the order amount', type => {
    const source = { ...order, items: [{ sku: 'ONE', name: 'One', quantity: 2 }, { sku: 'TWO', name: 'Two', quantity: 3 }] } as FopOrder
    const rows = buildRmaOrders({ subject, cases: [flow('a', { type, requestedAmount: type === 'refund' ? 5 : 20, currency: 'USD' })] }, grant, [source], {}, paths)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(20)
    expect(rows[0].items.map(item => [item.sku, item.quantity])).toEqual([['ONE', 2], ['TWO', 3]])
    expect(rows[0].rmaCases.map(item => item.requestedAmount)).toEqual([type === 'refund' ? 5 : 20])
  })
  it('separates confirmed refund amounts, after-sales types and order tags without replacing missing refund facts', () => {
    const rows = buildRmaOrders({ subject, cases: [flow('a', { requestedAmount: 15, refundAmount: 5, refundCurrency: 'USD' }), flow('b', { type: 'interception', reason: '拦截申请' }), flow('c', { type: 'interception_release' })] }, grant, [{ ...order, cancelled: false, shipmentInterceptStatus: 'released' }], {}, paths)
    expect(rows[0].refundAmounts).toEqual([{ currency: 'USD', amount: 5 }])
    expect(rows[0].orderTags).toEqual(['interception_released'])
    expect(rows[0].rmaCases.map(item => item.type)).toEqual(['refund', 'interception', 'interception_release'])
    const missing = buildRmaOrders({ subject, cases: [flow('a', { requestedAmount: 15, currency: 'USD' })] }, grant, [order], {}, paths)
    expect(missing[0].refundAmounts).toEqual([{ currency: null, amount: null }])
    expect(() => buildRmaOrders({ subject, cases: [flow('a', { refundAmount: -1, refundCurrency: 'USD' })] }, grant, [order], {}, paths)).toThrow()
  })
  it('distinguishes an open cancellation request from confirmed order cancellation', () => {
    const snapshot = { subject, cases: [flow('a', { type: 'cancellation', stage: '取消申请待审核' })] }
    expect(buildRmaOrders(snapshot, grant, [{ ...order, cancelled: false }], {}, paths)[0].orderTags).toEqual(['cancellation_requested'])
    expect(buildRmaOrders(snapshot, grant, [order], {}, paths)[0].orderTags).toEqual(['cancelled'])
  })
  it.each(['return_refund', 'reshipment'] as const)('rejects refund-only combined with %s before type filtering', type => {
    const snapshot = { subject, cases: [flow('a'), flow('b', { type })] }
    expect(() => buildRmaOrders(snapshot, grant, [order], {}, paths)).toThrow('Conflicting RMA after-sales types')
    expect(() => buildRmaOrders(snapshot, grant, [order], { type: 'refund' }, paths)).toThrow('Conflicting RMA after-sales types')
  })
  it('keeps partial refund installments and independent order events valid', () => {
    const rows = buildRmaOrders({ subject, cases: [flow('a', { refundAmount: 3, refundCurrency: 'USD' }), flow('b', { refundAmount: 2, refundCurrency: 'USD' }), flow('c', { type: 'interception' })] }, grant, [order], {}, paths)
    expect(rows[0].refundAmounts).toEqual([{ currency: 'USD', amount: 5 }])
    expect(rows[0].rmaCases).toHaveLength(3)
  })
  it('generates demo orders without mixing refund-only and other business types', () => {
    const sources = Array.from({ length: 32 }, (_, i) => ({ ...order, id: `order-${i}`, tenantId: 't1' })) as FopOrderCandidate[]
    const cases = demoRmaCases(subject, sources, Date.parse('2026-11-05T00:00:00Z'))
    expect(cases.some(row => row.type === 'refund')).toBe(true)
    expect(cases.some(row => row.type === 'return_refund')).toBe(true)
    expect(cases.some(row => row.type === 'reshipment')).toBe(true)
    for (const source of sources) {
      const types = cases.filter(row => row.orderId === source.id).map(row => row.type)
      if (types.includes('refund')) expect(types.filter(type => type === 'return_refund' || type === 'reshipment')).toEqual([])
    }
  })
  it('rejects wrong subjects, ambiguous active flags and duplicate case IDs', () => {
    expect(() => buildRmaOrders({ subject: { ...subject, userId: 'other' }, cases: [] }, grant, [order], {}, paths)).toThrow()
    expect(() => buildRmaOrders({ subject, cases: [flow('a', { isOpen: undefined })] }, grant, [order], {}, paths)).toThrow()
    expect(() => buildRmaOrders({ subject, cases: [flow('a'), flow('a')] }, grant, [order], {}, paths)).toThrow()
  })
  it('does not search hidden or differently classified cases or fabricate a latest-update timestamp', () => {
    const snapshot = { subject, cases: [flow('a', { reason: 'visible' }), flow('b', { type: 'interception', reason: 'private-query' }), flow('hidden', { reason: 'private-query' })] }
    expect(buildRmaOrders(snapshot, grant, [order], { type: 'refund', search: 'private-query' }, paths)).toEqual([])
    expect(buildRmaOrders(snapshot, grant, [order], { type: 'refund' }, paths)[0]).toMatchObject({ rmaUpdatedAt: null, rmaCases: [{ id: 'a', requestedAmount: null, currency: null }] })
    expect(buildRmaOrders(snapshot, { ...grant, allowedRmaCaseIds: [] }, [order], {}, paths)).toEqual([])
  })
})
