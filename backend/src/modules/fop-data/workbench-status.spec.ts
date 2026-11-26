import { compareFulfillmentOrders } from './fop-order-sort'
import type { FopOrder } from './fop-data.types'
import { canFilterTaskStatus, matchesTaskStatus, getDispatchTaskStatus, getProcurementTaskStatus, getTaskStatus, taskStatusOptions } from './workbench-status'

describe('compact workbench statuses', () => {
  it.each(['allocation', 'allocation_review'])('classifies %s by audited dispatches without waiting for Shopify', queue => {
    expect(taskStatusOptions(queue)).toEqual(['dispatch_incomplete', 'dispatch_complete'])
    for (const sync of ['pending', 'synced', 'unknown'] as const) {
      const row = { dispatchDocuments: [{ id: 'd', number: 'D', status: 'approved' }], fulfillmentProgress: { shopifySync: sync } } as FopOrder
      expect(getTaskStatus(row, queue)).toBe('dispatch_complete')
      for (const docs of [undefined, null, [], [{ id: 'd', number: 'D', status: 'unknown' }], [...row.dispatchDocuments!, { id: 'x', number: 'X', status: 'submitted' }]]) {
        expect(getTaskStatus({ ...row, dispatchDocuments: docs } as FopOrder, queue)).toBe('dispatch_incomplete')
      }
    }
  })
  it.each(['allocation', 'allocation_review'] as const)('sorts %s by binary completion and keeps payment order within each group', queue => {
    const make = (id: string, day: string, status: string) => ({ id, paidAt: `2026-10-${day}T00:00:00Z`, dispatchDocuments: [{ id, number: id, status }], fulfillmentProgress: { shopifySync: 'pending' } } as FopOrder)
    const rows = [make('complete', '04', 'approved'), make('submitted', '03', 'submitted'), make('draft', '02', 'draft'), make('unknown', '01', 'unknown')]
    rows.sort((a,b) => compareFulfillmentOrders(a,b,{ queue, sortBy: 'dispatchDocumentStatus', sortOrder: 'asc' }))
    expect(rows.map(row => row.id)).toEqual(['unknown', 'draft', 'submitted', 'complete'])
    rows.sort((a,b) => compareFulfillmentOrders(a,b,{ queue, sortBy: 'dispatchDocumentStatus', sortOrder: 'desc' }))
    expect(rows.map(row => row.id)).toEqual(['complete', 'unknown', 'draft', 'submitted'])
  })
  it.each(['pending_dispatch', 'pending_logistics', 'unknown'] as const)('keeps preparation actionable before logistics (%s)', logisticsGate => {
    expect(getProcurementTaskStatus({ purchaseOrder: 'not_ordered', purchaseApplication: 'created', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate }, 'pending')).toBe('purchase_order_pending')
  })
  it.each([['pending_dispatch', 'dispatch_preparation'], ['pending_logistics', 'dispatch_preparation'], ['unknown', 'alibaba_pending'], ['satisfied', 'alibaba_pending']] as const)('shows only the relevant prerequisite %s', (logisticsGate, expected) => {
    expect(getProcurementTaskStatus({ purchaseOrder: 'ordered', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate }, 'pending')).toBe(expected)
  })
  it('uses delivery status across every dispatch, keeping missing facts unknown', () => {
    expect(getDispatchTaskStatus([{id:'a',number:'A',status:'approved',deliveryStatus:'FULFILLED'},{id:'b',number:'B',status:'approved',deliveryStatus:'PENDING'}])).toBe('dispatch_pending')
    expect(getDispatchTaskStatus([{id:'a',number:'A',status:'approved'}], 'synced')).toBe('unknown')
    expect(getDispatchTaskStatus([])).toBe('dispatch_missing')
    expect(getDispatchTaskStatus(null)).toBe('unknown')
  })
  it('uses all FULFILLED delivery statuses, not an independent Shopify or audit flag', () => {
    const fulfilled = [{ id:'a',number:'FY-A',status:'approved' as const,deliveryStatus:'FULFILLED' }]
    for(const sync of ['synced','pending','unknown'] as const) expect(getDispatchTaskStatus(fulfilled,sync)).toBe('dispatch_synced')
    expect(getDispatchTaskStatus([...fulfilled,{id:'b',number:'FY-B',status:'approved',deliveryStatus:'TRACKING_OBTAINED'}],'synced')).toBe('dispatch_tracking')
    expect(getDispatchTaskStatus([...fulfilled,{id:'b',number:'FY-B',status:'approved',deliveryStatus:'UPDATING'}],'synced')).toBe('dispatch_updating')
  })
  it('sorts delivery stages and keeps unknown last in either direction', () => {
    const make=(id:string,deliveryStatus?:string)=>({id,paidAt:'2026-10-01T00:00:00Z',dispatchDocuments:[{id,number:id,status:'approved',deliveryStatus}],fulfillmentProgress:{shopifySync:'pending'}} as FopOrder)
    const rows=[make('synced','FULFILLED'),make('unknown'),make('updating','UPDATING'),make('pending','PENDING'),make('tracking','TRACKING_OBTAINED'),make('cancelled','CANCELLED')]
    rows.sort((a,b)=>compareFulfillmentOrders(a,b,{queue:'dispatch',sortBy:'dispatchDocumentStatus',sortOrder:'asc'}))
    expect(rows.map(r=>r.id)).toEqual(['pending','tracking','updating','cancelled','synced','unknown'])
    rows.sort((a,b)=>compareFulfillmentOrders(a,b,{queue:'dispatch',sortBy:'dispatchDocumentStatus',sortOrder:'desc'}))
    expect(rows.map(r=>r.id)).toEqual(['synced','cancelled','updating','tracking','pending','unknown'])
  })
  it('excludes active interception from pending outbound while keeping released and unmarked orders', () => {
    for (const [shipmentInterceptStatus, expected] of [['intercepted', false], ['released', true], [null, true], [undefined, true]] as const) {
      const row = { fulfillmentProgress: { outbound: 'pending' }, shipmentInterceptStatus } as FopOrder
      expect(matchesTaskStatus(row, 'shipping', 'outbound_pending')).toBe(expected)
    }
  })
  it('keeps legacy incomplete outbound in the whole-order pending state', () => {
    for (const outbound of ['pending', 'partial'] as const) expect(getTaskStatus({ fulfillmentProgress: { outbound } } as FopOrder, 'shipping')).toBe('outbound_pending')
    expect(canFilterTaskStatus('shipping', 'outbound_partial')).toBe(false)
  })
  it('offers only meaningful queue-specific filters, independently of the current page', () => {
    expect(taskStatusOptions('review')).toEqual([])
    expect(taskStatusOptions('unpaid')).toEqual([])
    expect(taskStatusOptions('shipping')).toEqual(['outbound_pending', 'shipment_intercepted', 'shipment_released'])
    expect(taskStatusOptions('procurement_shipping')).toEqual(['supplier_pending', 'supplier_partial'])
    expect(canFilterTaskStatus('review', 'payment_pending')).toBe(false)
    expect(canFilterTaskStatus('dispatch', 'dispatch_draft')).toBe(false)
    expect(canFilterTaskStatus('dispatch', 'dispatch_tracking')).toBe(true)
    for (const queue of ['dispatch', 'allocation', 'allocation_review']) expect(canFilterTaskStatus(queue, 'unknown')).toBe(false)
    expect(canFilterTaskStatus('procurement', ['payment_pending'])).toBe(false)
  })
})


describe('current procurement filter business states', () => {
  it('excludes obsolete filter states but keeps remaining payment and push tasks visible', () => {
    expect(taskStatusOptions('procurement')).toEqual(['purchase_order_pending', 'dispatch_preparation', 'payment_pending'])
    for (const state of ['unknown', 'application_pending', 'dispatch_missing', 'logistics_pending', 'supplier_pending']) expect(canFilterTaskStatus('procurement', state)).toBe(false)
    expect(taskStatusOptions('procurement')).not.toContain('logistics_unknown')
    expect(taskStatusOptions('procurement')).not.toContain('partially_paid')
    expect(canFilterTaskStatus('procurement', 'logistics_unknown')).toBe(false)
    expect(canFilterTaskStatus('procurement', 'partially_paid')).toBe(false)
  })
})

 it('separates missing and created dispatch filters', () => {
    expect(taskStatusOptions('dispatch')).toEqual(['dispatch_missing', 'dispatch_pending', 'dispatch_tracking'])
    for (const [stage, expected] of [['dispatch_missing', false], ['dispatch_pending', true], ['dispatch_tracking', false], ['dispatch_cancelled', false], ['dispatch_updating', false], ['unknown', false]] as const) {
      expect(matchesTaskStatus({ dispatchTaskStatus: stage } as FopOrder, 'dispatch', 'dispatch_pending')).toBe(expected)
    }
  })

describe('native source shipment plus active tracking', () => {
  it.each([
    ['paid', 'unfulfilled', [], 'dispatch_missing'],
    ['processing', 'unfulfilled', [{ number:'FY1', trackingNumbers: [] }], 'dispatch_pending'],
    ['processing', 'partial', [{ number:'FY1', deliveryStatus: 'PENDING', trackingNumbers: [{type:'full',number:'TRACK'}] }], 'dispatch_tracking'],
    ['processing', 'unfulfilled', [{ number:'FY1', deliveryStatus: 'TRACKING_OBTAINED', trackingNumbers: [] }], 'dispatch_pending'],
    ['processing', 'unfulfilled', [{ number:'FY1', trackingNumbers: [{type:'full',number:'   '}] }], 'dispatch_pending'],
    ['processing', 'unfulfilled', [{ rawInterceptStatus:'CANCELLED',trackingNumbers:[{type:'full',number:'OLD'}] }], 'dispatch_missing'],
    ['processing', 'unfulfilled', [{ number:'FY1', deliveryStatus:'CANCELLED',trackingNumbers:[{type:'full',number:'OLD'}] }], 'dispatch_missing'],
    ['fulfillment_cancelled', 'unfulfilled', [], 'dispatch_cancelled'],
    ['partial_fulfilled', 'fulfilled', [], 'dispatch_synced'], ['fulfilled', 'fulfilled', [], 'dispatch_synced'],
    ['paid', 'unfulfilled', [{ number:'FY1', trackingNumbers:[{type:'full',number:'CURRENT'}] }], 'dispatch_tracking'],
    ['processing', 'unfulfilled', null, 'unknown'],
    ['fulfilled', 'unfulfilled', [{number:'FY1',trackingNumbers:[]}], 'dispatch_pending'],
    ['processing', 'fulfilled', [], 'dispatch_synced'],
    ['fulfilled', undefined, [], 'unknown'],
    ['processing', 'unfulfilled', [{number:'FY1',association:{state:'unresolved'},trackingNumbers:[{type:'full',number:'UNVERIFIED'}]}], 'unknown'],
  ])('%s with source shipment %s uses the independent source fact', (state, sourceShipment, docs, expected) => {
    const order={businessStatus:{order:state,sourceShipment},dispatchDocuments:docs,dispatchTaskStatus:'dispatch_updating',reviewStatus:'approved'} as unknown as FopOrder
    expect(getTaskStatus(order,'dispatch')).toBe(expected)
  })
})
