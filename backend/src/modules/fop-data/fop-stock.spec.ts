import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopIdentity, FopPermissionGrant } from './fop-data.types'
import { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
import { UsersService } from '../users/users.service'
import * as ExcelJS from 'exceljs'
import { publicStockOrder } from './fop-stock'

const order = (id: string, extra: Partial<FopStockOrderCandidate> = {}): FopStockOrderCandidate => ({
  tenantId: 't', id, stockNumber: `BH261028${id}`, stockType: 'full_payment',
  customerId: 'c1', customerCode: 'C001', customerName: 'Customer One', storeName: 'Store One',
  owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, departmentPathIds: ['marketing', 'd1'], salesDepartmentCode: 'sales1',
  items: [{ sku: 'SKU-1', name: 'Product', imageUrl: null, variant: 'Blue', quantity: 10 }],
  warehouseCode: 'HZ', warehouse: '杭州仓', amount: 100, currency: 'USD', paidAt: '2026-10-01T01:00:00Z',
  purchaseStatus: 'unpurchased', cancelled: false, ...extra,
})
const inventory = (id: string, extra: Partial<FopStockInventoryCandidate> = {}): FopStockInventoryCandidate => ({
  tenantId: 't', id, customerId: 'c1', customerCode: 'C001', customerName: 'Customer One',
  owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, departmentPathIds: ['marketing', 'd1'], salesDepartmentCode: 'sales1',
  sku: 'SKU-1', name: 'Product', imageUrl: null, warehouseCode: 'HZ', warehouse: '杭州仓',
  fullPayment: { available: 12, locked: 3 }, deposit: { available: 7, locked: 2 }, ...extra,
})
class Provider extends FopDataProvider {
  orders = [order('1'), order('2', { stockType: 'deposit', purchaseStatus: 'received', paidAt: null }), order('3', { cancelled: true })]
  inventory = [inventory('i1'), inventory('i2', { customerId: 'c2', owner: { id: 'e2', name: 'Bob' }, department: { id: 'd2', name: '业务二部' }, departmentPathIds: ['d2'] })]
  grant: FopPermissionGrant = { subject: { tenantId: 't', userId: 'u' }, allowedOrderIds: [], allowedStockOrderIds: ['1', '2', '3'], allowedStockInventoryIds: ['i1', 'i2'] }
  isConfigured() { return true }
  async resolvePermissions() { return this.grant }
  async listOrders() { return [] }
  async listStockOrders(_identity: FopIdentity) { return this.orders }
  async listStockInventory(_identity: FopIdentity) { return this.inventory }
}
let provider: Provider, service: FopDataService
let user: Record<string, unknown>
beforeEach(() => {
  provider = new Provider()
  user = { id: 'u', role: 'admin', businessRole: 'salesperson', businessEmployeeId: 'e1', fopTenantId: 't', fopUserId: 'u', workbenchRoles: ['sales'] }
  service = new FopDataService({ findById: async () => user } as unknown as UsersService, provider)
})
const query = { page: 1, pageSize: 50 }
it('returns actual procurement payment time separately, leaving missing or invalid values unknown', async () => {
  provider.orders = [order('1', { purchaseStatus: 'purchased', procurementPaidAt: '2026-10-28T10:00:00+08:00' })]
  expect((await service.getStockOrders('u', query)).items[0].procurementPaidAt).toBe('2026-10-28T02:00:00.000Z')
  for (const procurementPaidAt of [undefined, null, 'invalid', '2026-02-30T12:00:00Z', '2026-10-28T10:00:00']) {
    provider.orders = [order('1', { purchaseStatus: 'purchased', procurementPaidAt })]
    expect((await service.getStockOrders('u', query)).items[0].procurementPaidAt).toBeNull()
  }
})
it.each([
  ['unpaid', 'pending', 'unpaid'], ['paid', 'pending', 'paid'], ['paid', 'approved', 'approved'],
  ['paid', 'unknown', null], ['unknown', 'approved', null], ['unpaid', 'approved', null],
  [undefined, undefined, null],
] as const)('derives stock status from payment %s and review %s without guessing from payment time', (paymentStatus, reviewStatus, expected) => {
  expect(publicStockOrder(order('1', { paymentStatus, reviewStatus }))).toMatchObject({ orderStatus: expected })
})
it('filters stock status before totals/paging and exports the same status scope', async () => {
  provider.orders = [order('1', { paymentStatus: 'paid', reviewStatus: 'pending' }), order('2', { paymentStatus: 'paid', reviewStatus: 'pending', stockType: 'deposit' }),
    order('3', { paymentStatus: 'paid', reviewStatus: 'approved' }), order('4', { paymentStatus: 'unpaid', reviewStatus: 'pending', paidAt: null }),
    order('5', { paymentStatus: 'paid', reviewStatus: 'pending', owner: { id: 'e2', name: 'Bob' } })]
  provider.grant.allowedStockOrderIds = provider.orders.map(row => row.id)
  const filter = { orderStatus: 'paid' as const }
  const page = await service.getStockOrders('u', { ...query, ...filter, pageSize: 1 })
  expect(page.items.map(row => row.id)).toEqual(['1'])
  expect(page.total).toBe(2); expect(page.totals.amounts).toEqual([{ currency: 'USD', amount: 200 }])
  expect((await service.getStockOrders('u', { ...query, ...filter, stockType: 'deposit', warehouseCode: 'HZ', departmentId: 'd1', search: 'alice' })).items.map(row => row.id)).toEqual(['2'])
  for (const mode of ['selected', 'filtered'] as const) {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await service.exportStockOrders('u', { ...filter, mode, ...(mode === 'selected' ? { orderIds: ['2'] } : {}) }) as never)
    const sheet = book.getWorksheet('备货清单')!
    const headings = sheet.getRow(1).values as string[]
    const statusColumn = headings.indexOf('备货订单状态')
    expect(statusColumn).toBeGreaterThan(0)
    expect(sheet.getCell(2, statusColumn).value).toBe('已支付')
    expect(sheet.rowCount).toBe(mode === 'selected' ? 3 : 4)
    expect(JSON.stringify(sheet.getSheetValues())).not.toContain('BH2610283')
  }
  await expect(service.exportStockOrders('u', { ...filter, mode: 'selected', orderIds: ['3'] })).rejects.toMatchObject({ status: 409 })
})
it('includes unpaid/completed stock orders and both types, excludes cancelled, strips private/fulfillment fields', async () => {
  Object.assign(provider.orders[0], { shopifyOrderNumber: '#SECRET', privateInfo: 'hidden' })
  const page = await service.getStockOrders('u', query)
  expect(page.items.map(row => row.id)).toEqual(['1', '2'])
  expect(page.items[0]).not.toHaveProperty('tenantId')
  expect(page.items[0]).not.toHaveProperty('shopifyOrderNumber')
  expect(page.items[0]).not.toHaveProperty('privateInfo')
  expect(page.totals.amounts).toEqual([{ currency: 'USD', amount: 200 }])
})
it('applies independent grants, tenant and local scope before options, totals and paging', async () => {
  provider.orders.push(order('4', { owner: { id: 'e2', name: 'Bob' }, department: { id: 'd2', name: '业务二部' }, departmentPathIds: ['d2'] }), order('5', { tenantId: 'other' }))
  provider.grant.allowedStockOrderIds = ['1', '2', '4', '5']
  const page = await service.getStockOrders('u', { ...query, pageSize: 1 })
  expect(page.total).toBe(2)
  expect(page.departments).toEqual([{ id: 'd1', name: '业务一部' }])
  provider.grant.allowedStockOrderIds = undefined
  expect((await service.getStockOrders('u', query)).total).toBe(0)
})
it('intersects type, warehouse, department and salesperson/SKU/name searches', async () => {
  expect((await service.getStockOrders('u', { ...query, search: 'alice', stockType: 'deposit', departmentId: 'd1', warehouseCode: 'HZ' })).items.map(r => r.id)).toEqual(['2'])
  expect((await service.getStockOrders('u', { ...query, warehouseCode: 'SZ' })).total).toBe(0)
  expect((await service.getStockOrders('u', { ...query, departmentId: 'd2' })).total).toBe(0)
})
it('sorts the entire result before paging and keeps missing payments last in both directions', async () => {
  provider.orders.push(order('4', { paidAt: '2026-10-03T01:00:00Z' }))
  provider.grant.allowedStockOrderIds = ['1', '2', '4']
  expect((await service.getStockOrders('u', { ...query, pageSize: 1, sortOrder: 'desc' })).items[0].id).toBe('4')
  expect((await service.getStockOrders('u', { ...query, sortOrder: 'desc' })).items.slice(-1)[0]?.id).toBe('2')
})
it('queries inventory by explicit permitted customer and keeps full/deposit balances separate without subtracting locks twice', async () => {
  const page = await service.getStockInventory('u', { ...query, customerId: 'c1' })
  expect(page.items[0].fullPayment).toEqual({ available: 12, locked: 3, onHand: 15 })
  expect(page.items[0].deposit).toEqual({ available: 7, locked: 2, onHand: 9 })
  expect(page.items[0].onHand).toBe(24)
  expect((await service.getStockCustomers('u', { search: 'Customer' })).items.map(c => c.id)).toEqual(['c1'])
  expect((await service.getStockInventory('u', { ...query, customerId: 'c2' })).items).toEqual([])
  provider.grant.allowedStockInventoryIds = []
  expect((await service.getStockInventory('u', { ...query, customerId: 'c1' })).items).toEqual([])
})
it('returns explicit zero stock, rejects invalid balances and duplicate authorized inventory IDs', async () => {
  provider.inventory = [inventory('i1', { fullPayment: { available: 0, locked: 0 }, deposit: { available: 0, locked: 0 } })]
  expect((await service.getStockInventory('u', { ...query, customerId: 'c1' })).items[0].onHand).toBe(0)
  provider.inventory[0].fullPayment.available = NaN
  await expect(service.getStockInventory('u', { ...query, customerId: 'c1' })).rejects.toMatchObject({ status: 503 })
  provider.inventory = [inventory('i1'), inventory('i1')]
  await expect(service.getStockInventory('u', { ...query, customerId: 'c1' })).rejects.toMatchObject({ status: 503 })
})
it('rejects unassigned roles and in-flight ownership changes', async () => {
  user.workbenchRoles = ['procurement']
  await expect(service.getStockOrders('u', query)).rejects.toMatchObject({ status: 403 })
  user.workbenchRoles = ['sales']
  provider.listStockOrders = async () => { user.businessEmployeeId = 'e2'; return provider.orders }
  await expect(service.getStockOrders('u', query)).rejects.toMatchObject({ status: 403 })
})
it('exports selected and filtered orders, preserves identifiers, currency totals, and excludes fulfillment columns', async () => {
  provider.orders[0].items.push({ sku: '=1+1', name: 'Second product', imageUrl: null, variant: '', quantity: 2 })
  provider.orders[1].currency = 'CNY'
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await service.exportStockOrders('u', { mode: 'filtered' }) as never)
  const sheet = book.getWorksheet('备货清单')!
  expect(sheet.rowCount).toBe(5)
  expect(sheet.getRow(1).values).not.toEqual(expect.arrayContaining(['Shopify 单号', 'Customer', '物流服务商']))
  expect(sheet.getCell('B2').value).toContain('=1+1')
  expect(sheet.getCell('D4').value).toBe(100); expect(sheet.getCell('D5').value).toBe(100)
  const selected = new ExcelJS.Workbook()
  await selected.xlsx.load(await service.exportStockOrders('u', { mode: 'selected', orderIds: ['2'] }) as never)
  expect(selected.getWorksheet('备货清单')!.getCell('A2').value).toBe(provider.orders[1].stockNumber)
  await expect(service.exportStockOrders('u', { mode: 'selected', orderIds: ['foreign'] })).rejects.toMatchObject({ status: 409 })
  await expect(service.exportStockOrders('u', { mode: 'filtered' }, 2)).rejects.toMatchObject({ status: 401 })
})
it('rechecks independent resource access after export generation', async () => {
  let reads = 0
  provider.listStockOrders = async () => { if (++reads > 1) return []; return provider.orders }
  await expect(service.exportStockOrders('u', { mode: 'filtered' })).rejects.toMatchObject({ status: 403 })
})

it('includes purchased stock awaiting shipment in the procurement queue and both exports within scope', async () => {
  user.workbenchRoles = ['procurement']
  provider.orders = [
    order('1', { paymentStatus: 'paid', reviewStatus: 'approved' }),
    order('2', { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'partial', stockType: 'deposit' }),
    order('3', { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'purchased' }),
    order('4', { paymentStatus: 'unpaid', reviewStatus: 'approved' }),
    order('5', { paymentStatus: 'paid', reviewStatus: 'pending' }), order('6'),
    order('7', { paymentStatus: 'paid', reviewStatus: 'approved', cancelled: true }),
    order('8', { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'purchased', owner: { id: 'e2', name: 'Bob' } }),
    order('9', { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'shipped' }),
    order('10', { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'received' }),
  ]
  provider.grant.allowedStockOrderIds = provider.orders.map(r => r.id)
  const page = await service.getStockOrders('u', { ...query, queue: 'procurement' })
  expect(page.items.map(r => r.id)).toEqual(['1', '2', '3'])
  expect(page.totals.orderCount).toBe(3)
  const filtered = await service.getStockOrders('u', { ...query, queue: 'procurement', purchaseStatus: 'purchased' })
  expect(filtered.items.map(row => row.id)).toEqual(['3'])
  expect(filtered.totals.amounts).toEqual([{ currency: 'USD', amount: 100 }])
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await service.exportStockOrders('u', { mode: 'filtered', queue: 'procurement' }) as never)
  expect(book.getWorksheet('备货清单')!.getCell('A5').value).toContain('合计')
  for (const mode of ['selected', 'filtered'] as const) {
    const filteredBook = new ExcelJS.Workbook()
    await filteredBook.xlsx.load(await service.exportStockOrders('u', { mode, queue: 'procurement', purchaseStatus: 'purchased', ...(mode === 'selected' ? { orderIds: ['3'] } : {}) }) as never)
    const sheet = filteredBook.getWorksheet('备货清单')!
    expect(sheet.rowCount).toBe(3)
    expect(sheet.getCell('A2').value).toBe('BH2610283')
    expect(sheet.getCell(2, (sheet.getRow(1).values as string[]).indexOf('采购状态')).value).toBe('供应商待发货')
  }
  await expect(service.exportStockOrders('u', { mode: 'selected', queue: 'procurement', orderIds: ['9'] })).rejects.toMatchObject({ status: 409 })
  await expect(service.getStockOrders('u', query)).rejects.toMatchObject({ status: 403 })
  user.workbenchRoles = ['sales']
  await expect(service.getStockOrders('u', { ...query, queue: 'procurement' })).rejects.toMatchObject({ status: 403 })
})
it('fuzzy-searches all authorized customers and SKU together before paging, without a customer-selection cap', async () => {
  user.workbenchRoles = ['procurement']
  provider.inventory = Array.from({ length: 105 }, (_, n) => inventory(`i${n}`, { customerId: `c${n}`, customerName: `Acme ${n}`, customerCode: `C${n}`, sku: `Sku-${n}`, warehouseCode: n % 2 ? 'HZ' : 'SZ' }))
  provider.inventory.push(inventory('foreign', { customerName: 'Acme Outside', owner: { id: 'e2', name: 'Bob' } }))
  provider.grant.allowedStockInventoryIds = provider.inventory.map(r => r.id)
  expect((await service.getStockInventory('u', { ...query, customerSearch: 'ACME', page: 3 })).items).toHaveLength(5)
  const result = await service.getStockInventory('u', { ...query, customerSearch: 'acme', search: 'sku-10', warehouseCode: 'HZ' })
  expect(result.items.map(r => r.sku).sort()).toEqual(['Sku-101', 'Sku-103'])
  expect(result.customerId).toBeNull()
  expect((await service.getStockInventory('u', query)).total).toBe(105)
  expect((await service.getStockInventory('u', { ...query, customerSearch: 'c104' })).items[0].customerId).toBe('c104')
  expect((await service.getStockInventory('u', { ...query, customerId: 'c1', customerSearch: 'absent' })).total).toBe(0)
})


it.each(['orderStatus', 'purchaseStatus'] as const)('sorts %s by business stage before pagination and both exports, with stable ties and unknowns last', async sortBy => {
  const states = sortBy === 'orderStatus'
    ? [{ paymentStatus: 'unpaid', reviewStatus: 'pending' }, { paymentStatus: 'paid', reviewStatus: 'pending' }, { paymentStatus: 'paid', reviewStatus: 'approved' }]
    : [{ purchaseStatus: 'unpurchased' }, { purchaseStatus: 'partial' }, { purchaseStatus: 'purchased' }, { purchaseStatus: 'shipped' }, { purchaseStatus: 'received' }]
  provider.orders = states.map((state, i) => order(`stage-${i}`, { ...state, paidAt: `2026-10-0${5 - i}T01:00:00Z` } as Partial<FopStockOrderCandidate>))
  provider.orders.push(order('tie-b', { ...states[1], paidAt: '2026-10-01T01:00:00Z' } as Partial<FopStockOrderCandidate>),
    order('tie-a', { ...states[1], paidAt: '2026-10-01T01:00:00Z' } as Partial<FopStockOrderCandidate>),
    order('missing', { purchaseStatus: 'unknown', paidAt: null }),
    order('foreign', { ...states[0], owner: { id: 'e2', name: 'Bob' } } as Partial<FopStockOrderCandidate>))
  provider.grant.allowedStockOrderIds = provider.orders.map(row => row.id)
  const asc = sortBy === 'orderStatus' ? ['stage-0', 'tie-a', 'tie-b', 'stage-1', 'stage-2', 'missing'] : ['stage-0', 'tie-a', 'tie-b', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'missing']
  const desc = sortBy === 'orderStatus' ? ['stage-2', 'tie-a', 'tie-b', 'stage-1', 'stage-0', 'missing'] : ['stage-4', 'stage-3', 'stage-2', 'tie-a', 'tie-b', 'stage-1', 'stage-0', 'missing']
  for (const [sortOrder, ids] of [['asc', asc], ['desc', desc]] as const) {
    const filters = { sortBy, sortOrder, warehouseCode: 'HZ', search: 'alice' }
    const result = await service.getStockOrders('u', { ...query, ...filters })
    expect(result.items.map(row => row.id)).toEqual(ids)
    expect(result.total).toBe(ids.length)
    expect((await service.getStockOrders('u', { ...query, ...filters, page: 2, pageSize: 1 })).items[0].id).toBe(ids[1])
    for (const mode of ['filtered', 'selected'] as const) {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(await service.exportStockOrders('u', { ...filters, mode, ...(mode === 'selected' ? { orderIds: ['stage-0', 'stage-2'] } : {}) }) as never)
      const sheet = book.getWorksheet('备货清单')!
      const numbers = Array.from({ length: sheet.rowCount - 2 }, (_, i) => sheet.getCell(i + 2, 1).value)
      expect(numbers).toEqual((mode === 'filtered' ? ids : sortOrder === 'asc' ? ['stage-0', 'stage-2'] : ['stage-2', 'stage-0']).map(id => `BH261028${id}`))
    }
  }
})
