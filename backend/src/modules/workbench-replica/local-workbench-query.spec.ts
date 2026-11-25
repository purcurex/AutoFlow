import { stockPurchaseSql } from './local-workbench-query'
import { buildLocalOrderQuery, localQueueCode, localResourceGrantSql } from './local-workbench-query'
import { localOrder, localStockOrder } from './local-workbench-mapping'

const scopes = [{ connectionId: 'connection', companyId: 'company', datasetId: 'dataset', employeeIds: ['123'] }]
describe('formal queue alignment with current list date and physical purchase facts', () => {
  it('requires verified completed allocations and an approved active dispatch before pending outbound', () => {
    const sql=buildLocalOrderQuery(scopes,{queue:'shipping'})
    expect(sql.where).toContain("allocation_approval.review_state='approved'")
    expect(sql.where).toContain("ds.raw_bill_status='C'")
    expect(sql.where).toContain("d.raw_delivery_status IS DISTINCT FROM 'CANCELLED'")
    expect(sql.where).toContain('NOT delivery.incomplete')
    expect(sql.from).toContain("a.raw_allocation_status IS DISTINCT FROM 'voided'")
    expect(sql.from).toContain("s.entity_code='hzkj_alloc_bill'")
    expect(sql.from).toContain('allocation_approval')
    expect(sql.where).not.toContain("intercept_status IS DISTINCT FROM 'intercepted'")
    const completed=buildLocalOrderQuery(scopes,{queue:'shipping',completed:true})
    expect(completed.where).not.toContain('allocation_approval')
    expect(completed.where).not.toContain('delivery.incomplete')
  })
  it.each(['review', 'dispatch', 'procurement', 'allocation_review', 'shipping'])('defaults completed %s to the last 90 days of customer payment', queue => {
    const sql = buildLocalOrderQuery(scopes, { queue, completed: true })
    expect(sql.where).toContain("o.customer_paid_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'")
    expect(sql.where).not.toContain('phase_completed_at >=')
  })
  it('defaults unpaid to 90 days of source payment and preserves unrestricted ordinary queues', () => {
    expect(buildLocalOrderQuery(scopes, { queue: 'unpaid' }).where).toContain("o.consumer_paid_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'")
    for (const queue of ['review', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'shipping', 'purchase_returns']) {
      expect(buildLocalOrderQuery(scopes, { queue }).where).not.toContain('customer_paid_at >=')
    }
    expect(buildLocalOrderQuery(scopes, { queue: 'procurement' }, true).where).not.toContain('customer_paid_at >=')
    expect(buildLocalOrderQuery(scopes, { queue: 'review', completed: true, timeRange: '3m' }).where).toContain("INTERVAL '90 days'")
  })
  it.each([{queue:'procurement'}, {queue:'procurement_shipping'}, {queue:'procurement',completed:true}])('does not let a legacy purchase header override physical membership: %j', query => {
    const sql = buildLocalOrderQuery(scopes, query)
    expect(sql.where).not.toContain('native.raw_purchase_status')
    expect(sql.where).toContain('owner_employee_id = ANY')
    expect(sql.where).toContain("decision = 'deny'")
  })
})
describe('local workbench query boundary', () => {
  it('rejects a stock-source filter before the formal replica has a verified source projection', () => {
    expect(() => buildLocalOrderQuery(scopes, {queue:'procurement',procurementSource:'full_payment'} as any)).toThrow('采购来源')
  })
  it('uses the UI month default for approved and sales stock, preserving explicit all',()=>{
    for(const stock of [false,true]){
      const query={queue:stock?'all':'review',completed:!stock}
      expect(buildLocalOrderQuery(scopes,query,stock)).toEqual(buildLocalOrderQuery(scopes,{...query,timeRange:'3m'},stock))
      expect(buildLocalOrderQuery(scopes,{...query,timeRange:'all'},stock).where).not.toContain('customer_paid_at >=')
    }
  })
  it('uses the warehouse resource enum defined by the database schema', () => {
    expect(buildLocalOrderQuery(scopes,{queue:'review',warehouseCode:'HZ'}).where).toContain("resource_type = 'warehouse'")
  })
  it('uses a whole-order SKU exists search before page SQL while retaining complete display lines', () => {
    const query = buildLocalOrderQuery(scopes, { queue: 'review', search: "SKU%'", page: 2, pageSize: 20 })
    expect(query.from).toContain('jsonb_to_recordset($1::jsonb)')
    expect(query.where).toContain('owner_employee_id = ANY')
    expect(query.where).toContain('EXISTS (SELECT 1 FROM hz_fop_workbench_order_lines search_line')
    expect(query.values).toContain("%sku\\%'%")
    expect(query.where).not.toContain("SKU%'")
    expect(query.queue).toBe('review')
    expect(query.orderBy).toContain('customer_paid_at DESC NULLS LAST')
    const order = localOrder(row(), [{ sku_code: 'MATCH', product_name: 'a', quantity: '1' }, { sku_code: 'OTHER', product_name: 'b', quantity: '2' }])
    expect(order.items.map(item => item.sku)).toEqual(['MATCH', 'OTHER'])
  })
  it('keeps an empty authorized member range restrictive and complete queues explicit', () => {
    const query = buildLocalOrderQuery([{ ...scopes[0], employeeIds: [] }], { queue: 'review', completed: true, page: 1, pageSize: 1 })
    expect(JSON.parse(query.values[0] as string)[0].employee_ids).toEqual([])
    expect(query.queue).toBe('sales_completed')
    expect(query.where).toContain('customer_paid_at >=')
    expect(localQueueCode('allocation_review', true)).toBe('allocation_completed')
  })
  it('gives explicit deny precedence and requires a current independently verified resource grant', () => {
    const sql = localResourceGrantSql('orders', 'sd.source_id')
    expect(sql).toContain("resource_type = 'orders'")
    expect(sql).toContain("decision = 'deny'")
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('expires_at > CURRENT_TIMESTAMP')
    expect(sql).toContain("INTERVAL '60 seconds'")
  })
  it('does not reinterpret source consumer time or unknown stages as customer payment and pending', () => {
    const order = localOrder({ ...row(), customer_paid_at: null, consumer_paid_at: '2026-01-01T00:00:00Z', order_review_state: 'unknown' }, [])
    expect(order.paidAt).toBeNull()
    expect(order.consumerPaidAt).toBeNull()
    expect(order.reviewStatus).toBe('unknown')
    expect(order.fulfillmentProgress.outbound).toBe('unknown')
  })
  it('keeps RMA resource grants independent and applies RMA type before pagination', () => {
    const query = buildLocalOrderQuery(scopes, { queue: 'rma', rmaType: 'refund', rmaFlowStatus: 'active' } as any)
    expect(query.from).toContain('hz_fop_rma_orders')
    expect(query.from).toContain("resource_type = 'rma'")
    expect(query.where).toContain('rm.is_open IS TRUE')
    expect(query.values).toContain('refund')
  })
  it('does not fabricate missing amounts or stock types', () => {
    expect(() => localOrder({ ...row(), total_amount: null }, [])).toThrow('amount')
    expect(() => localStockOrder({ ...row(), stock_type: null }, [])).toThrow('stock type')
  })
})
function row(): Record<string, any> { return { document_id: 'local', source_id: '1000000000000000001', order_number: 'TO1', total_amount: '12.20', currency_code: 'USD', customer_paid_at: '2026-11-01T00:00:00Z', customer_payment_state: 'paid', order_review_state: 'approved', stock_type: 'full_payment' } }

it('keeps the paid order’s selected carrier and channel before a tracking number exists', () => {
  const logistics = [{ carrierName: '云途YT', channelName: '云途标准专线', channelCode: 'MOCK-YT-STD', shopifyTracking: null }]
  const result = localOrder({ ...row(), logistics_packages: logistics }, [])
  expect(result.carrier).toBe('云途YT')
  expect(result.logisticsChannels).toEqual([{ name: '云途标准专线', code: 'MOCK-YT-STD' }])
  expect(result.logisticsInfo).toEqual([{ carrierName: '云途YT', channelName: '云途标准专线', channelCode: 'MOCK-YT-STD', shopifyTracking: null, trackingNumbers: undefined }])
  expect(result.trackingNumber).toBeNull()
})
it('preserves synced tracking with its carrier and does not fabricate missing real data', () => {
  const result = localOrder({ ...row(), logistics_packages: [{ carrierName: '4PX', channelName: '递四方标准专线', channelCode: 'MOCK-4PX-STD', shopifyTracking: { type: 'full', number: '4PX123' } }] }, [])
  expect(result.trackingNumber).toBe('4PX123')
  expect(localOrder(row(), []).carrier).toBeNull()
})

it('sorts dispatch audit time by the same linked value shown on the page',()=>{expect(buildLocalOrderQuery(scopes,{queue:'dispatch',completed:true,sortBy:'completedAt',sortOrder:'desc'}).orderBy).toMatch(/^delivery.audited_at DESC/)})

it('preserves the actual sales approval time instead of a projection completion timestamp',()=>{expect(localOrder({...row(),queue_code:'sales_completed',source_audited_at:'2026-11-10T10:00:00Z',phase_completed_at:'2026-11-11T10:00:00Z'},[]).reviewedAt).toBe('2026-11-10T10:00:00.000Z')})

it('keeps source checkout independent for unpaid date range, sort and response',()=>{
 const q=buildLocalOrderQuery(scopes,{queue:'unpaid',timeRange:'1w',sortBy:'consumerPaidAt'})
 expect(q.where).toContain('o.consumer_paid_at >=')
 expect(q.orderBy).toMatch(/^o.consumer_paid_at DESC/)
 expect(localOrder({...row(),customer_paid_at:'2026-10-01T00:00:00Z',consumer_paid_at:'2026-09-01T00:00:00Z'},[]).sourceOrderPaidAt).toBe('2026-09-01T00:00:00.000Z')
 expect(localOrder({...row(),consumer_paid_at:null},[]).sourceOrderPaidAt).toBeNull()
})

it('uses the same unnumbered grouping in the formal local replica',()=>{
 const q=buildLocalOrderQuery(scopes,{queue:'dispatch',taskStatus:'dispatch_pending'})
 expect(q.where).toContain("delivery.has_tracking")
 expect(q.where).toContain("IN ('unfulfilled','partial')")
 expect(q.values).toContain('dispatch_pending')
 expect(q.where).toContain('owner_employee_id = ANY')
})

it('keeps native sync failures supplementary to normal dispatch queues with scope intact',()=>{
 for(const completed of [false,true]){
  const q=buildLocalOrderQuery(scopes,{queue:'dispatch',completed})
  expect(q.where).not.toContain("d.raw_delivery_status='SYNC_FAILED'")
  expect(q.where).not.toContain("NOT ((native.raw_order_status='6') OR ((sd.raw_bill_status")
  expect(q.where).toContain('owner_employee_id = ANY')
 }
 const q=buildLocalOrderQuery(scopes,{queue:'exceptions',taskStatus:'dispatch_exception'})
 expect(q.from).toContain('hz_fop_fulfillment_orders native')
 expect(q.where).toContain("d.raw_delivery_status='SYNC_FAILED'")
 expect(q.where).toContain("r.removed_at IS NULL")
 expect(q.values).toContain('dispatch_exception')
})

 it('uses the native package tracking independently of Shopify selection and keeps explicit blanks',()=>{
  for(const number of ['PKG-001',null]) {
   const result=localOrder({...row(),logistics_packages:[{channelName:'实际中文渠道',packageTrackingNumber:number,shopifyTracking:{type:'full',number:'OTHER'}}]},[])
   expect(result.logisticsInfo?.[0].packageTrackingNumber).toBe(number)
   expect(result.trackingNumber).toBe(number)
  }
 })

it('uses current same-order package tracking for fulfilled gating and dispatch exception display',()=>{
 const q=buildLocalOrderQuery(scopes,{queue:'exceptions',taskStatus:'dispatch_exception'})
 for(const clause of ['pkg.order_document_id=o.document_id','pkg.connection_id=o.connection_id','pkg.company_id=o.company_id','pkg.dataset_id=o.dataset_id','pkg.expected_active IS TRUE','pkg.removed_at IS NULL','pkg.tracking_number']) expect(q.where).toContain(clause)
 expect(localOrder({...row(),fulfilled_tracking_missing:true,native_order_status:'4'},[]).exception).toMatchObject({type:'dispatch_exception',reason:'履约订单物流跟踪号为空'})
})

it('maps missing obtained tracking to dispatch exception without changing the fulfillment order status',()=>{
 const order=localOrder({...row(),obtained_tracking_missing:true,native_order_status:'3'},[])
 expect(order.exception).toMatchObject({type:'dispatch_exception',reason:'已取号订单缺少物流跟踪号'})
 expect(order.businessStatus?.order).toBe('processing')
})
it('reads stock purchase status from the native stock header, not derived supplier stages',()=>{

 expect(stockPurchaseSql).toContain('hz_fop_stock_orders')
 expect(stockPurchaseSql).toContain('raw_purchase_status')
 expect(stockPurchaseSql).toContain("WHEN '1' THEN 'in_progress'")
 expect(stockPurchaseSql).toContain("WHEN '2' THEN 'purchased'")
 expect(stockPurchaseSql).not.toMatch(/supplier_shipment_state|procurement_stage|purchase_coverage_state/)
})
it('retains simultaneous dispatch causes in the formal local adapter',()=>{
 expect(localOrder({...row(),native_order_status:'4',dispatch_sync_failed:true,fulfilled_tracking_missing:true},[]).exception?.reason).toBe('发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
})
