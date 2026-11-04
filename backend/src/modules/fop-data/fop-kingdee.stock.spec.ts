import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopDataService } from './fop-data.service'
import type { UsersService } from '../users/users.service'
import type { BusinessScope } from '../users/business-scope'
import type { FopPermissionGrant } from './fop-data.types'
import * as ExcelJS from 'exceljs'

const identity = { tenantId: 'offline', userId: '100' }
const admin: BusinessScope = { role: 'admin', employeeId: null, departmentId: null }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/orders', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_STOCK_PERMISSIONS_URL: 'https://example.test/stock-permissions',
  FOP_KINGDEE_STOCK_ORDERS_URL: 'https://example.test/stock-orders', FOP_KINGDEE_STOCK_INVENTORY_URL: 'https://example.test/stock-inventory',
  FOP_KINGDEE_TENANT_ID: 'offline', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-token', FOP_KINGDEE_IDENTITY: 'offline-identity',
  FOP_KINGDEE_WAREHOUSE_MAP: '{"20":"HZ","21":"SZ"}', FOP_KINGDEE_DEPARTMENT_MAP: '{"400":"sales1","401":"sales2"}',
  FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: '{"WH-HZ":"HZ","WH-SZ":"SZ","WH-SZ-OLD":"SZ"}',
}
const ref = (id: string, name = id) => ({ id, name })
const ownership = { organization: ref('10'), department: ref('400', '业务一部'), departmentPathIds: ['10', '400'], owner: ref('100', 'Alice'),
  customer: { ...ref('200', 'Customer'), number: 'C001' }, warehouse: { ...ref('20', '杭州仓'), number: 'WH-HZ' } }
const order = (id = '1000', extra: Record<string, unknown> = {}) => ({ ...ownership, id, stockNumber: `BH-${id}`, stockType: '1', orderStatus: '2', billStatus: 'C',
  purchaseStatus: '3', amount: '123.45', currency: 'USD', paidAt: '2026-10-28T08:00:00+08:00', createdAt: '2026-10-27T01:00:00Z', procurementPaidAt: null, storeName: null,
  items: [{ sku: 'SKU-1', name: 'Lamp', variant: null, imageUrl: null, quantity: '2.50' }], ...extra })
const inventory = (id = '9000', extra: Record<string, unknown> = {}) => ({ ...ownership, id, sku: 'SKU-1', name: 'Lamp', imageUrl: null,
  fullPayment: { available: '0.10', locked: '2' }, deposit: { available: '3', locked: '1' }, ...extra })
function setup(options: { config?: Record<string, string>; grants?: { orders: string[]; inventory: string[] }; page?: (resource: string, page: number) => Record<string, unknown> } = {}) {
  const request = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)).query
    const resource = String(url).endsWith('stock-orders') ? 'orders' : 'inventory'
    const data = String(url).endsWith('stock-permissions') ? { schemaVersion: 1, subject: identity, grants: options.grants ?? { orders: ['10'], inventory: ['10'] } }
      : { schemaVersion: 1, subject: identity, resource, organizationIds: ['10'], page: body.page, pageSize: 100, hasMore: false,
        items: resource === 'orders' ? [order()] : [inventory()], ...options.page?.(resource, body.page) }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data }))
  })
  const config = { ...settings, ...options.config }
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
  const user = { id: 'local', role: 'admin', businessRole: 'admin', businessEmployeeId: '100', fopTenantId: identity.tenantId, fopUserId: identity.userId,
    fopBindingDetails: { username: 'offline', name: 'Offline', employeeRecordId: '100', employeeMasterId: '100', departmentId: '400', organizationId: '10',
      localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } }
  const service = new FopDataService({ findById: async () => user } as unknown as UsersService, provider)
  return { provider, request, service, user }
}

it('reads independent stock grants and never calls fulfillment or Shopify routes', async () => {
  const { provider, request } = setup()
  const grant = await provider.resolveStockPermissions(identity, admin)
  expect(grant).toEqual({ subject: identity, allowedOrderIds: [], stockQuery: { orders: ['10'], inventory: ['10'] } })
  const rows = await provider.listStockOrders(identity, grant, admin)
  expect(rows[0]).toMatchObject({ stockType: 'full_payment', paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'received', amount: 123.45,
    storeName: null, procurementPaidAt: null, items: [{ sku: 'SKU-1', quantity: 2.5, variant: '' }] })
  expect(request.mock.calls.map(call => String(call[0]))).toEqual([settings.FOP_KINGDEE_STOCK_PERMISSIONS_URL, settings.FOP_KINGDEE_STOCK_ORDERS_URL])
})

it('maps both stock types and payment/audit stages without hiding received records', async () => {
  const { service } = setup({ page: () => ({ items: [order('1000', { orderStatus: '1', billStatus: 'A', paidAt: null, purchaseStatus: '0' }),
    order('1001', { stockType: '2', billStatus: 'A', purchaseStatus: '1' }), order('1002'), order('1003', { purchaseStatus: '4' })] }) })
  const page = await service.getStockOrders('local', { page: 1, pageSize: 1 })
  expect(page.total).toBe(4); expect(page.totals.orderCount).toBe(4); expect(page.totals.amounts).toEqual([{ currency: 'USD', amount: 493.8 }])
  const paid = await service.getStockOrders('local', { page: 1, pageSize: 50, orderStatus: 'paid', stockType: 'deposit', purchaseStatus: 'partial' })
  expect(paid.items.map(row => row.id)).toEqual(['1001'])
  expect((await service.getStockOrders('local', { page: 1, pageSize: 50, orderStatus: 'approved', purchaseStatus: 'received' })).items.map(row => row.id)).toEqual(['1002'])
})

it('exports selected real-adapter stock orders and preserves all SKU quantities', async () => {
  const { service } = setup()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await service.exportStockOrders('local', { mode: 'selected', orderIds: ['1000'] }) as never)
  expect(workbook.getWorksheet('备货清单')!.getCell('A2').value).toBe('BH-1000')
  expect(workbook.getWorksheet('商品明细')!.getCell('E2').value).toBe(2.5)
})

it('totals fractional stock quantities without floating point tail errors', async () => {
  const { service } = setup({ page: () => ({ items: [order('1000', { items: [{ sku: 'SKU-1', name: 'Lamp', variant: '', imageUrl: null, quantity: '0.1' }] }),
    order('1001', { items: [{ sku: 'SKU-2', name: 'Lamp', variant: '', imageUrl: null, quantity: '0.2' }] })] }) })
  expect((await service.getStockOrders('local', { page: 1, pageSize: 50 })).totals.itemQuantity).toBe(0.3)
})

it('retains historical header-only orders in lists, totals and Excel without inventing product rows', async () => {
  const { service } = setup({ page: () => ({ items: [order('1000', { items: [] })] }) })
  const page = await service.getStockOrders('local', { page: 1, pageSize: 50 })
  expect(page.items[0].items).toEqual([])
  expect(page.totals).toMatchObject({ orderCount: 1, itemQuantity: 0, amounts: [{ currency: 'USD', amount: 123.45 }] })
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await service.exportStockOrders('local', { mode: 'filtered' }) as never)
  expect(JSON.stringify(book.getWorksheet('备货清单')!.getSheetValues())).toContain('BH-1000')
  expect(JSON.stringify(book.getWorksheet('备货清单')!.getSheetValues())).toContain('暂无商品明细')
  expect(book.getWorksheet('商品明细')!.rowCount).toBe(1)
})

it('keeps the 77th header-only order and surrounding products across full source pages, totals and exports', async () => {
  const { service } = setup({ page: (_resource, page) => ({ hasMore: page === 1, items: page === 1
    ? Array.from({ length: 100 }, (_, index) => order(String(1000 + index), index === 76 ? { items: [] } : {}))
    : [order('2000')] }) })
  const first = await service.getStockOrders('local', { page: 1, pageSize: 50 })
  const second = await service.getStockOrders('local', { page: 2, pageSize: 50 })
  const last = await service.getStockOrders('local', { page: 3, pageSize: 50 })
  const rows = [...first.items, ...second.items, ...last.items]
  expect(rows).toHaveLength(101)
  expect(new Set(rows.map(row => row.id)).size).toBe(101)
  expect(rows.find(row => row.id === '1076')?.items).toEqual([])
  for (const id of ['1075', '1077', '2000']) expect(rows.find(row => row.id === id)?.items[0]).toMatchObject({ sku: 'SKU-1', quantity: 2.5 })
  expect(first.totals).toEqual({ orderCount: 101, itemQuantity: 250, amounts: [{ currency: 'USD', amount: 12468.45 }] })
  expect(second.totals).toEqual(first.totals)
  for (const mode of ['filtered', 'selected'] as const) {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await service.exportStockOrders('local', { mode, ...(mode === 'selected' ? { orderIds: ['1075', '1076', '1077'] } : {}) }) as never)
    const sheet = book.getWorksheet('备货清单')!
    expect(sheet.getColumn(1).values).toContain('BH-1076')
    expect(JSON.stringify(sheet.getSheetValues())).toContain('暂无商品明细')
    expect(sheet.rowCount).toBe(mode === 'filtered' ? 103 : 5)
    expect(book.getWorksheet('商品明细')!.rowCount).toBe(mode === 'filtered' ? 101 : 3)
  }
})

it.each([undefined, null, {}, [{ sku: '', name: 'Lamp', variant: null, imageUrl: null, quantity: '1' }]])('keeps unloaded or invalid detail values as errors: %j', async items => {
  const { service } = setup({ page: () => ({ items: [order('1000', { items })] }) })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503 })
})

it('requires the independent stock code mapping even when the original warehouse ID mapping is configured', async () => {
  const { service } = setup({ config: { FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: '' } })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503, response: { code: 'fop_mapping_required' } })
})

it('maps stock by warehouse number when the ID and name change, preserving the original ID mapping semantics elsewhere', async () => {
  const { service } = setup({ config: { FOP_KINGDEE_WAREHOUSE_MAP: '{"20":"SZ"}' },
    page: () => ({ items: [order('1000', { warehouse: { id: '999', name: 'Renamed warehouse', number: 'WH-HZ' } })] }) })
  const page = await service.getStockOrders('local', { page: 1, pageSize: 50, warehouseCode: 'HZ' })
  expect(page.total).toBe(1)
  expect(page.items[0]).toMatchObject({ warehouseCode: 'HZ', warehouse: 'Renamed warehouse' })
})

it('keeps leading zeros in warehouse numbers without depending on the original ID map', async () => {
  const { service } = setup({ config: { FOP_KINGDEE_WAREHOUSE_MAP: '', FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: '{"01":"HZ"}' },
    page: () => ({ items: [order('1000', { warehouse: { id: '20', name: 'Warehouse', number: '01' } })] }) })
  expect((await service.getStockOrders('local', { page: 1, pageSize: 50 })).items[0].warehouseCode).toBe('HZ')
})

it('maps multiple confirmed Shenzhen warehouse numbers to SZ and keeps inventory balances grouped by customer, SKU and business warehouse', async () => {
  const { provider, service } = setup({ page: resource => ({ items: resource === 'orders'
    ? [order('1000', { warehouse: { id: '21', name: 'Current Shenzhen', number: 'WH-SZ' } }), order('1001', { warehouse: { id: '22', name: 'Old Shenzhen', number: 'WH-SZ-OLD' } })]
    : [inventory('9000', { warehouse: { id: '21', name: 'Current Shenzhen', number: 'WH-SZ' } }), inventory('9001', { warehouse: { id: '22', name: 'Old Shenzhen', number: 'WH-SZ-OLD' } })] }) })
  expect((await service.getStockOrders('local', { page: 1, pageSize: 50, warehouseCode: 'SZ' })).total).toBe(2)
  const grant = await provider.resolveStockPermissions(identity, admin)
  const rows = await provider.listStockInventory(identity, grant, admin)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ warehouseCode: 'SZ', fullPayment: { available: 0.2, locked: 4 }, deposit: { available: 6, locked: 2 } })
})

it.each([undefined, null, '', ' ', '1', 'wh-hz', 'UNMAPPED', 'toString'])('rejects absent or unconfigured warehouse number without matching ID or name: %j', async number => {
  const { service } = setup({ page: () => ({ items: [order('1000', { warehouse: { id: '20', name: '杭州仓', number } })] }) })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503 })
})

it.each(['{"":"HZ"}', '{"WH-HZ":"OTHER"}', '{"WH-HZ":true}'])('rejects invalid stock-only warehouse code configuration: %s', async value => {
  const { service } = setup({ config: { FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: value } })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503, response: { code: 'fop_mapping_required' } })
})

it.each([
  [{ role: 'admin', employeeId: null, departmentId: null }, true],
  [{ role: 'department_manager', employeeId: null, departmentId: '400' }, true],
  [{ role: 'department_manager', employeeId: null, departmentId: '401' }, false],
  [{ role: 'salesperson', employeeId: '100', departmentId: null }, false],
] as [BusinessScope, boolean][])('shows an unassigned historical owner only within existing scope %j', async (scope, allowed) => {
  const { provider } = setup({ page: () => ({ items: [order('1000', { owner: null })] }) })
  const grant = await provider.resolveStockPermissions(identity, scope)
  if (allowed) expect((await provider.listStockOrders(identity, grant, scope))[0].owner).toEqual({ id: 'unassigned', name: '未分配' })
  else await expect(provider.listStockOrders(identity, grant, scope)).rejects.toThrow()
})

it('keeps inventory current-customer ownership required even when historical stock orders allow unassigned owners', async () => {
  const { provider } = setup({ page: () => ({ items: [inventory('9000', { owner: null })] }) })
  const grant = await provider.resolveStockPermissions(identity, admin)
  await expect(provider.listStockInventory(identity, grant, admin)).rejects.toThrow()
})

it('keeps inventory permission independent and merges duplicate dimensions with decimal arithmetic', async () => {
  const { provider } = setup({ page: () => ({ items: [inventory(), inventory('9001', { fullPayment: { available: '0.20', locked: '1' } })] }) })
  const grant = await provider.resolveStockPermissions(identity, admin)
  const rows = await provider.listStockInventory(identity, grant, admin)
  expect(rows).toHaveLength(1); expect(rows[0].fullPayment).toEqual({ available: 0.3, locked: 3 })
  const denied = setup({ grants: { orders: ['10'], inventory: [] } })
  expect((await denied.service.getStockInventory('local', { orderIds: ['1000'], page: 1, pageSize: 50 })).total).toBe(0)
  expect(denied.request.mock.calls.some(call => String(call[0]).endsWith('stock-inventory'))).toBe(false)
})

it('matches selected stock inventory through the query grant without using an empty ID allowlist as authorization', async () => {
  const { service } = setup()
  const page = await service.getStockInventory('local', { orderIds: ['1000'], page: 1, pageSize: 50 })
  expect(page.total).toBe(1); expect(page.items[0].onHand).toBe(6.1)
  await expect(service.getStockInventory('local', { orderIds: ['9999'], page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 409 })
  const denied = setup({ grants: { orders: [], inventory: ['10'] } })
  expect((await denied.service.getStockOrders('local', { page: 1, pageSize: 50 })).total).toBe(0)
})

it.each(['FOP_KINGDEE_STOCK_PERMISSIONS_URL', 'FOP_KINGDEE_STOCK_ORDERS_URL'])('reports missing %s as unavailable instead of an empty stock list', async key => {
  const { service } = setup({ config: { [key]: '' } })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503, response: { code: 'fop_feature_not_configured' } })
})

it.each([
  { organization: ref('20') }, { department: ref('401'), departmentPathIds: ['10', '401'] }, { owner: ref('999') },
])('rejects a stock row outside salesperson/company scope: %j', async extra => {
  const { provider } = setup({ page: () => ({ items: [order('1000', extra)] }) })
  const scope = { role: 'salesperson' as const, departmentId: null, employeeId: '100' }
  const grant = await provider.resolveStockPermissions(identity, scope)
  if ('department' in extra) {
    await expect(provider.listStockOrders(identity, grant, { role: 'department_manager', departmentId: '400', employeeId: null })).rejects.toThrow()
  } else await expect(provider.listStockOrders(identity, grant, scope)).rejects.toThrow()
})

it.each([
  { subject: { tenantId: 'other', userId: '100' } }, { organizationIds: ['20'] }, { page: 2 }, { pageSize: 101 },
  { hasMore: true }, { items: [order('1000'), order('1000')] }, { items: [order('1000', { id: 1000 })] },
  { items: [order('1000', { stockType: '9' })] }, { items: [order('1000', { orderStatus: '0' })] },
  { items: [order('1000', { amount: '-1' })] }, { items: [order('1000', { paidAt: '2026-10-01 12:00:00' })] },
])('rejects invalid or changed stock pages instead of reporting partial totals: %j', async invalid => {
  const { service } = setup({ page: () => invalid })
  await expect(service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toThrow()
})

it('collects every bounded page before local filtering, totals and pagination', async () => {
  const { provider, request } = setup({ page: (_resource, page) => ({ hasMore: page === 1, items: page === 1
    ? Array.from({ length: 100 }, (_, index) => order(String(1000 + index))) : [order('2000')] }) })
  const scope = { role: 'department_manager' as const, departmentId: '400', employeeId: null }
  const grant = await provider.resolveStockPermissions(identity, scope)
  expect(await provider.listStockOrders(identity, grant, scope)).toHaveLength(101)
  expect(JSON.parse(String(request.mock.calls[request.mock.calls.length - 1][1]?.body)).query).toMatchObject({ page: 2, pageSize: 100, scopeRole: 'department_manager', departmentIds: ['400'] })
})

it('rejects repeated IDs across pages and changed customer ownership during inventory collection', async () => {
  const duplicate = setup({ page: (_resource, page) => ({ hasMore: page === 1, items: page === 1
    ? Array.from({ length: 100 }, (_, index) => order(String(1000 + index))) : [order('1000')] }) })
  await expect(duplicate.service.getStockOrders('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503 })
  const changed = setup({ page: () => ({ items: [inventory(), inventory('9001', { owner: ref('101') })] }) })
  await expect(changed.service.getStockInventory('local', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503 })
})

it('rejects grants for a different configured organization', async () => {
  const { provider } = setup({ grants: { orders: ['20'], inventory: ['10'] } })
  await expect(provider.resolveStockPermissions(identity, admin)).rejects.toThrow()
  const wrongSubject: FopPermissionGrant = { subject: { tenantId: 'other', userId: '100' }, allowedOrderIds: [], stockQuery: { orders: ['10'], inventory: [] } }
  await expect(provider.listStockOrders(identity, wrongSubject, admin)).rejects.toThrow()
})
