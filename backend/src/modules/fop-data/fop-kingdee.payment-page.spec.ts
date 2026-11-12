import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import type { FopOrderPageQuery } from './fop-data.types'

const identity = { tenantId: 'test', userId: '100' }
const scope = { role: 'admin' as const, employeeId: null, departmentId: null }
const ref = (id: string) => ({ id, name: id })
const recent = new Date(Date.now() - 3600000).toISOString()
const old = '2020-01-01T00:00:00Z'

function setup(queue: 'review' | 'unpaid' | 'dispatch') {
  const config: Record<string, string> = {
    FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
    FOP_KINGDEE_CUSTOMER_RECEIPTS_URL: 'https://example.test/receipts', FOP_KINGDEE_ORGANIZATION_NUMBERS: '{"10":"company"}',
    FOP_KINGDEE_ORGANIZATION_IDS: '10', FOP_KINGDEE_ACCESS_TOKEN: 'fixture', FOP_KINGDEE_IDENTITY: 'fixture',
    FOP_KINGDEE_TENANT_ID: 'test', FOP_KINGDEE_USER_ID: '100',
    FOP_KINGDEE_WAREHOUSE_MAP: '{"900":"HZ"}',
  }
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(1000 + i), orderNumber: `TO-${i}`, shopifyOrderNumber: `#${i}`, organization: ref('10'),
    department: ref('400'), departmentPathIds: ['10', '400'], owner: ref('500'), customer: ref('200'), store: ref('300'), warehouse: ref('900'),
    orderStatus: queue === 'unpaid' ? '1' : '2', billStatus: queue === 'dispatch' ? 'C' : 'A', amount: '10', currency: 'USD', createdAt: old, paidAt: i === 100 ? recent : old,
    consumerPaidAt: i === 100 ? old : recent,
    ...(queue === 'dispatch' ? { dispatchTaskStatus: 'dispatch_missing', dispatchDocuments: [], logisticsInfo: [], fulfillmentProgress: { shopifySync: 'pending' }, shippingRecipient: null, shippingCountryCode: 'US' } : {}),
    items: [1, 2].map(n => ({ id: `${1000 + i}${n}`, parentId: '0', sequence: n, rowType: null, sku: `SKU-${n}`, name: 'Product', variant: '', quantity: '1' })),
  }))
  const requests: Record<string, unknown>[] = []
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, async (url, init) => {
    if (String(url).endsWith('/receipts')) throw new Error('Unnecessary cross-document receipt read')
    const q = JSON.parse(String(init?.body)).query; requests.push(q)
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: {
      subject: identity, schemaVersion: 1, organizationIds: ['10'], queue, basis: queue === 'unpaid' ? 'unpaid_active_self' : queue === 'dispatch' ? 'paid_tracking_pending_active' : 'submitted_paid_active',
      ...(queue === 'dispatch' ? { dispatchSchemaVersion: 1, departments: [ref('400')], salespeople: [ref('500')] } : {}),
      page: q.page, pageSize: q.pageSize, total: rows.length, items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      totals: { orderCount: rows.length, itemQuantity: '202', amountsByCurrency: [{ currency: 'USD', amount: '1010' }] },
    } }))
  })
  const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: [queue], organizationIds: ['10'] } }
  const query: FopOrderPageQuery = { queue, timeRange: '1w', warehouseCode: 'HZ', page: 1, pageSize: 1 }
  return { provider, requests, grant, query }
}

it.each(['review', 'unpaid', 'dispatch'] as const)('%s filters all pages by the order receipt date without querying receipts', async queue => {
  const { provider, grant, query, requests } = setup(queue)
  const result = await provider.queryOrders(identity, grant, scope, query)
  expect(result.total).toBe(1)
  if (queue === 'dispatch') {
    expect(result.departments).toEqual([ref('400')])
    expect(result.salespeople).toEqual([ref('500')])
  }
  expect(result.items[0]).toMatchObject({ id: '1100', consumerPaidAt: recent, warehouseCode: 'HZ' })
  expect(result.items[0].items.map(i => i.sku)).toEqual(['SKU-1', 'SKU-2'])
  expect(result.totals).toEqual({ orderCount: 1, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 10 }] })
  expect(requests).toHaveLength(2)
  expect(requests.every(q => q.timeRange === undefined && q.scopeRole === 'admin')).toBe(true)
  const summary = await provider.queryOrders(identity, grant, scope, { ...query, exportManifest: true }, true)
  expect(summary).toMatchObject({ total: 1, items: [], orderIds: ['1100'] })
  const second = await provider.queryOrders(identity, grant, scope, { ...query, page: 2 })
  expect(second.total).toBe(1)
  expect(second.items).toEqual([])
})

it('counts the same authorized list using one page without receipts, details or summary endpoint', async () => {
  const { provider, grant, query, requests } = setup('review')
  const result = await provider.queryOrders(identity, grant, scope, { ...query, timeRange: undefined, warehouseCode: undefined, projection: 'count' } as FopOrderPageQuery)
  expect(result).toMatchObject({ total: 101, items: [], totals: { orderCount: 101 } })
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ page: 1, pageSize: 1 })
})

it.each(['unpaid', 'review'] as const)('preserves full authorized %s export manifests beyond the API page limit', async queue => {
  const { provider, grant, query, requests } = setup(queue)
  const result = await provider.queryOrders(identity, grant, scope, { ...query, timeRange: undefined, warehouseCode: undefined,
    pageSize: 10000, exportManifest: true }, true)
  expect(result.total).toBe(101)
  expect(result.orderIds).toHaveLength(101)
  expect(requests).toHaveLength(2)
})
