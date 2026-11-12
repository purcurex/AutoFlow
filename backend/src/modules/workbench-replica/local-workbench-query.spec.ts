import { buildLocalOrderQuery, localQueueCode, localResourceGrantSql } from './local-workbench-query'
import { localOrder, localStockOrder } from './local-workbench-mapping'

const scopes = [{ connectionId: 'connection', companyId: 'company', datasetId: 'dataset', employeeIds: ['123'] }]
describe('local workbench query boundary', () => {
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
