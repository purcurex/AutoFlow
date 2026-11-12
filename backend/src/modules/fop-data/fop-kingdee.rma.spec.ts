import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { buildRmaOrders } from './rma-orders'
const identity = { tenantId: 'test', userId: '100' }
const scope = { role: 'salesperson' as const, employeeId: '500', departmentId: '400' }
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'] as 'review'[], organizationIds: ['10'] } }
const ref = (id: string) => ({ id, name: id })
const rawOrder = (id: string, patch: Record<string, unknown> = {}) => ({ id, billno: `TO${id}`, billstatus: 'C', createtime: '2026-01-01T00:00:00Z',
  hzkj_receipt_date: '2026-01-02T00:00:00Z', hzkj_billtype: { number: 'hzkj_orders_BT' }, hzkj_org: ref('10'), hzkj_operator: ref('500'), hzkj_dept: ref('400'),
  departmentPathIds: ['10', '400'], hzkj_customer: ref('200'), hzkj_shop: ref('300'), hzkj_currency: { number: 'CNY' }, hzkj_settlecurrency: { number: 'USD' }, hzkj_order_amount: '12.5', hzkj_receipt_status: '1', hzkj_orderstatus: '0',
  hzkj_orders_billentry: ['1','2'].map(n => ({ id: `${id}${n}`, hzkj_qty: '1', hzkj_local_sku: { number: `SKU${n}`, name: 'Product' } })), ...patch })
const rawRma = (patch: Record<string, unknown> = {}) => ({ id: '900', number: 'RMA900', hzkj_srcnumber: 'TO1000', hzkj_shop_id: '300', hzkj_sales_type: 'B', hzkj_orderstatus: '1',
  createtime: '2026-11-09 17:20:32', modifytime: '2026-11-09 17:21:01', hzkj_refund_amount: 2.5, hzkj_resason1: 'Customer request', ...patch })
function setup(options: { rmas?: Record<string, unknown>[]; orders?: Record<string, unknown>[]; envelope?: Record<string, unknown>; noUrl?: boolean; denied?: boolean } = {}) {
  const requests: { key: string; body: any }[] = []
  const config: Record<string, string> = { FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary', FOP_KINGDEE_RMA_URL: options.noUrl ? '' : 'https://example.test/rma',
    FOP_KINGDEE_RMA_ORDER_LIST_URL: 'https://example.test/native-orders', FOP_KINGDEE_ORGANIZATION_NUMBERS: '{"10":"company"}', FOP_KINGDEE_WORKBENCH_FACTS_MODE: 'raw', FOP_KINGDEE_TENANT_ID: 'test', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10', FOP_KINGDEE_ACCESS_TOKEN: 'fixture', FOP_KINGDEE_IDENTITY: 'fixture' }
  const p = new KingdeeFopDataProvider({ get: key => config[key] }, async (url, init) => {
    const body = JSON.parse(String(init?.body)), key = String(url).endsWith('/rma') ? 'rma' : String(url).endsWith('/native-orders') ? 'native' : 'orders'; requests.push({ key, body })
    if (key === 'rma' && options.denied) return new Response(JSON.stringify({ status: false, errorCode: '2504' }))
    const native = (options.orders ?? [rawOrder('1000')]).map(o => ({ id: o.id, billno: o.billno, hzkj_customer_id: '200', hzkj_payingcustomer_id: '200', hzkj_operator_id: '500', hzkj_shop_id: '300' }))
    const data = key === 'native' ? { pageNo: 1, pageSize: 200, lastPage: true, totalCount: native.length, rows: native } : key === 'rma' ? { pageNo: body.pageNo, pageSize: 100, lastPage: true, totalCount: (options.rmas ?? [rawRma()]).length, rows: options.rmas ?? [rawRma()] }
      : { subject: identity, organizationIds: ['10'], workbenchFactsSchemaVersion: 1, queue: 'review', page: 1, pageSize: 1, hasMore: false, items: options.orders ?? [rawOrder('1000')], ...options.envelope }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data }))
  })
  return { p, requests, read: () => p.queryRmaOrders(identity, grant, scope) }
}
it('reads real independently authorized RMA cases and full source orders, including cancelled orders', async () => {
  const { read, requests } = setup(), result = await read()
  expect(requests).toEqual(expect.arrayContaining([{ key: 'rma', body: { data: { hzkj_payingcustomer_id: '200' }, pageNo: 1, pageSize: 100 } }]))
  expect(result.permission.allowedRmaCaseIds).toEqual(['900']); expect(result.permission.allowedOrderIds).toEqual(['1000'])
  const rows = buildRmaOrders(result.snapshot, result.permission, result.orders, { search: 'SKU1' }, new Map())
  expect(rows).toHaveLength(1); expect(rows[0].items).toHaveLength(2)
  expect(rows[0]).toMatchObject({ cancelled: true, consumerPaidAt: '2026-01-02T00:00:00.000Z', refundAmounts: [{ amount: 2.5, currency: null }] })
  expect(rows[0].rmaCases[0]).toMatchObject({ type: 'refund', isOpen: true, stage: '待处理', updatedAt: '2026-11-09T09:21:01.000Z' })
})
it.each(['0','3','4','5','6'])('maps native RMA status %s to closed instead of pending', async state => {
  const r = await setup({ rmas: [rawRma({ hzkj_orderstatus: state })] }).read()
  expect(r.snapshot.cases[0].isOpen).toBe(false)
})
it.each([
  { envelope: { subject: { tenantId: 'other', userId: '100' } } },
  { orders: [rawOrder('1000', { hzkj_operator: ref('501') })] },
  { orders: [rawOrder('1000', { hzkj_org: ref('11') })] },
  { rmas: [rawRma({ hzkj_orderstatus: 'unknown' })] },
  { rmas: [rawRma(), rawRma()] },
])('rejects wrong scope and malformed/duplicate native facts %j', async options => { await expect(setup(options).read()).rejects.toThrow() })
it('never associates a fuzzy source, wrong shop, or another customer with a source order', async () => {
  const x = await setup({ rmas: [rawRma({ hzkj_srcnumber: 'TO10001' }), rawRma({ id: '901', hzkj_shop_id: '301' })] }).read()
  expect(x.snapshot.cases).toEqual([])
})
it('requires the native RMA endpoint authorization independently of order permissions', async () => {
  await expect(setup({ denied: true }).read()).rejects.toMatchObject({ code: 'fop_api_not_authorized' })
  await expect(setup({ noUrl: true }).read()).rejects.toMatchObject({ code: 'fop_rma_not_configured' })
})

it('reuses only the discovery index; cases and exact employee authorization are refreshed each time', async () => {
  const { read, requests } = setup(); await read(); await read()
  expect(requests.filter(r => r.key === 'native')).toHaveLength(1)
  expect(requests.filter(r => r.key === 'rma')).toHaveLength(2)
  expect(requests.filter(r => r.key === 'orders')).toHaveLength(2)
})

import { FopDataService } from './fop-data.service'
import type { UsersService } from '../users/users.service'
import * as ExcelJS from 'exceljs'
it('serves a real-provider RMA list and exports the selected whole order without the legacy listOrders path', async () => {
  const { p } = setup()
  jest.spyOn(p, 'resolvePermissions').mockResolvedValue(grant)
  const user = { id: 'local', role: 'user', businessRole: 'salesperson', businessEmployeeId: '500', businessDepartmentId: '400', workbenchRoles: ['sales'], fopTenantId: 'test', fopUserId: '100', sessionVersion: 0, fopBindingDetails: { username: 'alex', employeeRecordId: '500', employeeMasterId: '500', departmentId: '400', organizationId: '10', verifiedAt: '2026-01-01T00:00:00Z' } }
  const service = new FopDataService({ findById: async () => user } as unknown as UsersService, p)
  const page = await service.getRmaOrders('local', { page: 1, pageSize: 20, flowStatus: 'active', search: 'SKU1' })
  expect(page).toMatchObject({ source: 'fop', total: 1, totals: { caseCount: 1, itemQuantity: 2 } })
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await service.exportRmaOrders('local', { flowStatus: 'active', mode: 'selected', caseIds: [page.items[0].id] }) as never)
  const values = JSON.stringify(book.worksheets.map(sheet => sheet.getSheetValues()))
  expect(values).toContain('SKU1'); expect(values).toContain('SKU2'); expect(values).toContain('RMA900')
})
it('does not reveal a source which is no longer visible through the employee endpoint', async () => {
  const { p } = setup({ orders: [rawOrder('1001')] })
  const result = await p.queryRmaOrders(identity, grant, scope)
  expect(result.snapshot.cases).toEqual([])
})
it('does not default a missing refund currency from the original order currency', async () => {
  const result = await setup().read()
  expect(result.snapshot.cases[0]).toMatchObject({ refundAmount: 2.5, refundCurrency: null })
})
it('keeps historical RMA records without a native status in all, without labeling them closed', async () => {
  const r = await setup({ rmas: [rawRma({ hzkj_orderstatus: '' })] }).read()
  expect(r.snapshot.cases[0]).toMatchObject({ isOpen: null, stage: '状态未提供' })
  expect(buildRmaOrders(r.snapshot, r.permission, r.orders, { flowStatus: 'all' }, new Map())).toHaveLength(1)
  expect(buildRmaOrders(r.snapshot, r.permission, r.orders, { flowStatus: 'closed' }, new Map())).toHaveLength(0)
  expect(buildRmaOrders(r.snapshot, r.permission, r.orders, { flowStatus: 'active' }, new Map())).toHaveLength(0)
})
it('loads exact employee source facts only for the requested workflow while retaining all cases on matched orders', async () => {
  const { p, requests } = setup({ rmas: [rawRma({ hzkj_orderstatus: '3' })] })
  const result = await p.queryRmaOrders(identity, grant, scope, 'active')
  expect(result.snapshot.cases).toEqual([])
  expect(requests.filter(r => r.key === 'orders')).toHaveLength(0)
})
it('does not label settlement order amounts with the base currency when settlement currency is absent', async () => {
  const r = await setup({ orders: [rawOrder('1000', { hzkj_currency: { number: 'CNY' }, hzkj_settlecurrency: null })] }).read()
  expect(r.orders[0].currency).toBe('XXX')
})
