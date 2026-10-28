import { compareFulfillmentOrders } from './fop-order-sort'
import type { FopOrder } from './fop-data.types'
import { canFilterTaskStatus, getDispatchTaskStatus, getProcurementTaskStatus, getTaskStatus, taskStatusOptions } from './workbench-status'

describe('compact workbench statuses', () => {
  it('classifies allocation review by completed dispatch preparation without waiting for Shopify', () => {
    expect(taskStatusOptions('allocation_review')).toEqual(['dispatch_incomplete', 'dispatch_complete'])
    for (const sync of ['pending', 'synced', 'unknown'] as const) {
      const row = { dispatchDocuments: [{ id: 'd', number: 'D', status: 'approved' }], fulfillmentProgress: { shopifySync: sync } } as FopOrder
      expect(getTaskStatus(row, 'allocation_review')).toBe('dispatch_complete')
      for (const docs of [undefined, null, [], [{ id: 'd', number: 'D', status: 'unknown' }], [...row.dispatchDocuments!, { id: 'x', number: 'X', status: 'submitted' }]]) {
        expect(getTaskStatus({ ...row, dispatchDocuments: docs } as FopOrder, 'allocation_review')).toBe('dispatch_incomplete')
      }
    }
  })
  it('sorts allocation review by binary completion and keeps payment order within each group', () => {
    const make = (id: string, day: string, status: string) => ({ id, paidAt: `2026-10-${day}T00:00:00Z`, dispatchDocuments: [{ id, number: id, status }], fulfillmentProgress: { shopifySync: 'pending' } } as FopOrder)
    const rows = [make('complete', '04', 'approved'), make('submitted', '03', 'submitted'), make('draft', '02', 'draft'), make('unknown', '01', 'unknown')]
    rows.sort((a,b) => compareFulfillmentOrders(a,b,{ queue: 'allocation_review', sortBy: 'dispatchDocumentStatus', sortOrder: 'asc' }))
    expect(rows.map(row => row.id)).toEqual(['unknown', 'draft', 'submitted', 'complete'])
    rows.sort((a,b) => compareFulfillmentOrders(a,b,{ queue: 'allocation_review', sortBy: 'dispatchDocumentStatus', sortOrder: 'desc' }))
    expect(rows.map(row => row.id)).toEqual(['complete', 'unknown', 'draft', 'submitted'])
  })
  it.each(['pending_dispatch', 'pending_logistics', 'unknown'] as const)('keeps preparation actionable before logistics (%s)', logisticsGate => {
    expect(getProcurementTaskStatus({ purchaseOrder: 'not_ordered', purchaseApplication: 'created', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate }, 'pending')).toBe('purchase_order_pending')
  })
  it.each([['pending_dispatch', 'dispatch_preparation'], ['pending_logistics', 'dispatch_preparation'], ['unknown', 'alibaba_pending'], ['satisfied', 'alibaba_pending']] as const)('shows only the relevant prerequisite %s', (logisticsGate, expected) => {
    expect(getProcurementTaskStatus({ purchaseOrder: 'ordered', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate }, 'pending')).toBe(expected)
  })
  it('does not claim completion when one of several dispatches is unfinished or unknown', () => {
    expect(getDispatchTaskStatus([{ id: 'a', number: 'A', status: 'approved' }, { id: 'b', number: 'B', status: 'draft' }])).toBe('dispatch_draft')
    expect(getDispatchTaskStatus([{ id: 'a', number: 'A', status: 'unknown' }, { id: 'b', number: 'B', status: 'draft' }])).toBe('unknown')
    expect(getDispatchTaskStatus([])).toBe('dispatch_missing')
    expect(getDispatchTaskStatus(null)).toBe('unknown')
  })
  it('uses confirmed sync as the terminal stage only after every dispatch is approved', () => {
    const approved = [{ id: 'a', number: 'FY-A', status: 'approved' as const }]
    expect(getDispatchTaskStatus(approved, 'synced')).toBe('dispatch_synced')
    expect(getDispatchTaskStatus(approved, 'pending')).toBe('dispatch_approved')
    expect(getDispatchTaskStatus(approved, 'unknown')).toBe('dispatch_approved')
    expect(getDispatchTaskStatus([...approved, { id: 'b', number: 'FY-B', status: 'draft' }], 'synced')).toBe('dispatch_draft')
    expect(getDispatchTaskStatus(null, 'synced')).toBe('unknown')
  })
  it('sorts the sequential dispatch result and keeps unknown last', () => {
    const make = (id: string, status: 'draft' | 'submitted' | 'approved' | 'unknown', synced = false) => ({ id, paidAt: '2026-10-01T00:00:00Z', dispatchDocuments: [{ id, number: id, status }], fulfillmentProgress: { shopifySync: synced ? 'synced' : 'pending' } } as FopOrder)
    const rows = [make('synced', 'approved', true), make('unknown', 'unknown'), make('approved', 'approved'), make('draft', 'draft'), make('submitted', 'submitted')]
    rows.sort((a, b) => compareFulfillmentOrders(a, b, { queue: 'dispatch', sortBy: 'dispatchDocumentStatus', sortOrder: 'asc' }))
    expect(rows.map(row => row.id)).toEqual(['draft', 'submitted', 'approved', 'synced', 'unknown'])
    rows.sort((a, b) => compareFulfillmentOrders(a, b, { queue: 'dispatch', sortBy: 'dispatchDocumentStatus', sortOrder: 'desc' }))
    expect(rows.map(row => row.id)).toEqual(['synced', 'approved', 'submitted', 'draft', 'unknown'])
  })
  it('offers only meaningful queue-specific filters, independently of the current page', () => {
    expect(taskStatusOptions('review')).toEqual([])
    expect(taskStatusOptions('unpaid')).toEqual([])
    expect(taskStatusOptions('shipping')).toEqual(['outbound_pending', 'outbound_partial'])
    expect(taskStatusOptions('procurement_shipping')).toEqual(['supplier_pending', 'supplier_partial'])
    expect(canFilterTaskStatus('review', 'payment_pending')).toBe(false)
    expect(canFilterTaskStatus('dispatch', 'dispatch_draft')).toBe(true)
    for (const queue of ['dispatch', 'allocation', 'allocation_review']) expect(canFilterTaskStatus(queue, 'unknown')).toBe(false)
    expect(canFilterTaskStatus('procurement', ['payment_pending'])).toBe(false)
  })
})


describe('current procurement filter business states', () => {
  it('excludes obsolete filter states but keeps remaining payment and push tasks visible', () => {
    expect(taskStatusOptions('procurement')).toEqual(['purchase_order_pending', 'dispatch_preparation', 'alibaba_pending', 'payment_pending', 'refund_pending'])
    for (const state of ['unknown', 'application_pending', 'dispatch_missing', 'logistics_pending', 'supplier_pending']) expect(canFilterTaskStatus('procurement', state)).toBe(false)
    expect(taskStatusOptions('procurement')).not.toContain('logistics_unknown')
    expect(taskStatusOptions('procurement')).not.toContain('partially_paid')
    expect(canFilterTaskStatus('procurement', 'logistics_unknown')).toBe(false)
    expect(canFilterTaskStatus('procurement', 'partially_paid')).toBe(false)
  })
})
