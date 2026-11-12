import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { FopPermissionDeniedError } from './fop-data.types'

const identity = { tenantId: 'tenant', userId: '100' }
const scope = { role: 'admin' as const, employeeId: null, departmentId: null }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_ORDER_DETAIL_URL: 'https://example.test/detail',
  FOP_KINGDEE_TENANT_ID: 'tenant', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'test-token', FOP_KINGDEE_IDENTITY: 'test-identity',
}
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'] as 'review'[], organizationIds: ['10'] } }
const ref = (id: string) => ({ id, name: 'Fixture' })
function fixture() {
  return { id: '9007199254740993123', orderNumber: 'SO-FIXTURE', shopifyOrderNumber: '#101',
    customer: ref('200'), store: ref('300'), organization: ref('10'), department: ref('400'), owner: ref('500'), warehouse: null,
    amount: '123.45', currency: 'USD', billStatus: 'A', orderStatus: '2', createdAt: '2026-11-01T00:00:00Z', paidAt: null,
    consumerPaidAt: '2026-11-01T00:00:00Z', items: [{ id: '600', parentId: '0', rowType: 0, sequence: 1, sku: 'SKU', name: 'Product', variant: '', quantity: '2' }] }
}
function detail() {
  return { id: '9007199254740993123', billno: 'SO-FIXTURE', billstatus: 'A', hzkj_orderstatus: '2', hzkj_billtype_number: 'hzkj_orders_BT',
    hzkj_customer_id: '200', hzkj_operator_id: '500', hzkj_customer_first_name: 'Ada', hzkj_customer_last_name: 'Lovelace',
    hzkj_phone: '', hzkj_email: 'ada@example.test', hzkj_city: 'London', hzkj_post_code: 'SW1A 1AA',
    hzkj_address1: '24 Demo Road', hzkj_address2: 'Flat 2', hzkj_country_twocountrycode: 'GB',
    hzkj_admindivision_name: 'Must not infer province', hzkj_purchase_status: '2', hzkj_order_amount: '1' }
}
function setup(options: { detail?: Record<string, unknown>; page?: Record<string, unknown>; enabled?: boolean; detailResponse?: unknown; row?: Record<string, unknown> } = {}) {
  const requests: { url: string; body: unknown }[] = []
  const fetcher = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), body })
    const data = String(url).endsWith('/detail')
      ? options.detailResponse ?? { pageNo: 1, pageSize: 1, lastPage: true, totalCount: 1, rows: [{ ...detail(), ...options.detail }], ...options.page }
      : { subject: identity, queue: 'review', basis: 'submitted_paid_active', organizationIds: ['10'], page: body.query.page, pageSize: body.query.pageSize, total: 1,
        items: [{ ...fixture(), ...options.row }], totals: { orderCount: 1, itemQuantity: '2', amountsByCurrency: [{ currency: 'USD', amount: '123.45' }] } }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => options.enabled === false && key === 'FOP_KINGDEE_ORDER_DETAIL_URL' ? undefined : settings[key] }, fetcher)
  return { provider, requests, read: () => provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 20 }) }
}

describe('authorized fulfillment detail enrichment', () => {
  it('adds the order recipient while preserving totals and progress and leaving unconfirmed customer payment time null', async () => {
    const { read, requests } = setup(); const result = await read()
    expect(result.items[0]).toMatchObject({ amount: 123.45, consumerPaidAt: null, procurementStatus: 'unknown', shippingCountryCode: 'GB',
      shippingRecipient: { name: 'Ada Lovelace', phone: null, email: 'ada@example.test', state: null, city: 'London', postalCode: 'SW1A 1AA', addressLine1: '24 Demo Road', addressLine2: 'Flat 2' } })
    expect(result.total).toBe(1)
    expect(requests[1]).toEqual({ url: 'https://example.test/detail', body: { data: { id: '9007199254740993123' }, pageNo: 1, pageSize: 1 } })
  })
  it.each([
    { id: '9007199254740993124' }, { id: Number('9007199254740993') }, { billno: 'OTHER' }, { hzkj_customer_id: '201' },
    { hzkj_operator_id: '501' }, { hzkj_customer_id: null }, { billstatus: 'C' }, { hzkj_orderstatus: '0' }, { hzkj_billtype_number: 'stock' },
  ])('rejects mismatched detail instead of disclosing unrelated recipient data: %j', async patch => {
    await expect(setup({ detail: patch }).read()).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
  it.each([{ totalCount: 2 }, { lastPage: false }, { rows: [] }, { pageNo: 2 }, { pageSize: 20 }])('rejects missing, ambiguous or incomplete detail pages: %j', async page => {
    await expect(setup({ page }).read()).rejects.toThrow()
  })
  it('keeps absent fields unknown and does not borrow customer contact or infer country from its name', async () => {
    const result = await setup({ detail: { hzkj_country_twocountrycode: '', hzkj_customer_first_name: '', hzkj_customer_last_name: '',
      hzkj_email: null, hzkj_address1: null, hzkj_address2: null, hzkj_country_name: 'United Kingdom', hzkj_link_user: 'Account contact' } }).read()
    expect(result.items[0]).toMatchObject({ shippingCountryCode: null, shippingRecipient: { name: null, email: null, addressLine1: null, addressLine2: null, state: null } })
  })
  it('does not enrich an order lacking a verifiable customer or owner', async () => {
    const { read, requests } = setup({ row: { customer: null }, page: {} })
    const result = await read()
    expect(result.items[0].shippingRecipient).toBeUndefined(); expect(requests).toHaveLength(1)
  })
  it('leaves existing adapters unchanged when the independent detail URL is not configured', async () => {
    const { read, requests } = setup({ enabled: false }); const result = await read()
    expect(result.items[0].shippingRecipient).toBeUndefined(); expect(requests).toHaveLength(1)
  })
  it('does not request a recipient when the page organization is outside the current grant', async () => {
    const { provider, requests } = setup()
    await expect(provider.queryOrders(identity, { ...grant, orderQuery: { queues: ['review'], organizationIds: [] } }, scope,
      { queue: 'review', page: 1, pageSize: 20 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
    expect(requests).toHaveLength(1)
  })
})

it('uses the verified SKU archive picture for a matching order line, preserving the original when no archive picture exists', async () => {
  const result = await setup({ detail: { hzkj_orders_billentry: [{ id: '600', hzkj_local_sku_number: 'SKU', hzkj_local_sku_hzkj_picturefield: 'https://images.example.test/sku.jpg' }] }, row: {
    items: [{ id: '600', parentId: '0', rowType: 0, sequence: 1, sku: 'SKU', name: 'Product', variant: '', quantity: '2', imageUrl: 'https://images.example.test/deleted-shopify.jpg' }],
  } }).read()
  expect(result.items[0].items[0].imageUrl).toBe('https://images.example.test/sku.jpg')
})
it.each([
  { id: '601', hzkj_local_sku_number: 'SKU', hzkj_local_sku_hzkj_picturefield: 'https://images.example.test/other.jpg' },
  { id: '600', hzkj_local_sku_number: 'OTHER', hzkj_local_sku_hzkj_picturefield: 'https://images.example.test/other.jpg' },
  { id: '600', hzkj_local_sku_number: 'SKU', hzkj_local_sku_hzkj_picturefield: '' },
  { id: '600', hzkj_local_sku_number: 'SKU', hzkj_local_sku_hzkj_picturefield: 'javascript:alert(1)' },
])('does not substitute an unrelated or invalid SKU picture: %j', async line => {
  const original = 'https://images.example.test/source.jpg'
  const result = await setup({ detail: { hzkj_orders_billentry: [line] }, row: {
    items: [{ id: '600', parentId: '0', rowType: 0, sequence: 1, sku: 'SKU', name: 'Product', variant: '', quantity: '2', imageUrl: original }],
  } }).read()
  expect(result.items[0].items[0].imageUrl).toBe(original)
})

it('does not request row details or a statistics endpoint for an authorized list count', async () => {
  const { provider, requests } = setup()
  const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 1, projection: 'count' })
  expect(result).toMatchObject({ total: 1, items: [], totals: { orderCount: 1 } })
  expect(requests.map(r => r.url)).toEqual(['https://example.test/page'])
})
it('rejects an unauthorized organization even on the count shortcut', async () => {
  const { provider, requests } = setup()
  await expect(provider.queryOrders(identity, { ...grant, orderQuery: { queues: ['review'], organizationIds: [] } }, scope,
    { queue: 'review', page: 1, pageSize: 1, projection: 'count' })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  expect(requests).toHaveLength(1)
})
