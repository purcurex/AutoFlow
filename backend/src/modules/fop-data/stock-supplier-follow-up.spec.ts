import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopPermissionGrant } from './fop-data.types'
import type { FopStockOrderCandidate } from './fop-stock.types'
import type { UsersService } from '../users/users.service'

const identity = { tenantId: 't', userId: 'u' }
const stock: FopStockOrderCandidate = { tenantId: 't', id: 's1', stockNumber: 'BH261109000001', stockType: 'full_payment', customerId: 'c', customerCode: 'C', customerName: 'Customer', owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '一部' }, storeName: null, items: [{ sku: 'SKU1', name: 'Lamp', quantity: 10, imageUrl: null, variant: 'White' }], amount: 100, currency: 'USD', paidAt: '2026-11-01T00:00:00Z', paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'purchased', warehouseCode: 'HZ', warehouse: '杭州仓', cancelled: false }
const contact = (purchaseOrderId = 'p1') => ({ tenantId: 't', stockOrderId: 's1', purchaseOrderId, purchaseOrderNumber: `CG-${purchaseOrderId}`, platformOrderNumber: '5127833916176022434', supplier: { id: 'v1', name: '供应商', wangwangAccount: 'seller' }, chatUrl: 'aliim:sendmsg?touid=cnalichnseller', paid: true, cancelled: false, shipmentStatus: 'pending' as const, lines: [{ stockLineId: 'sl1', purchaseLineId: 'pl1', sku: 'SKU1', name: 'Lamp', pendingQuantity: 10 }] })
class Provider extends FopDataProvider {
  readonly source = 'mock' as const
  readonly supportsStockSupplierFollowUp = true
  orders = [structuredClone(stock)]
  grant: FopPermissionGrant = { subject: identity, allowedOrderIds: [], allowedStockOrderIds: ['s1'], allowedPurchaseOrderIds: ['p1', 'p2'] }
  contacts = [contact()]
  afterContacts = () => {}
  isConfigured() { return true }
  async resolvePermissions() { return this.grant }
  async listOrders() { return [] }
  async listStockOrders() { return this.orders }
  async listStockSupplierFollowUps() { const result = { subject: identity, orderId: 's1', items: this.contacts }; this.afterContacts(); return result }
}
let provider: Provider, service: FopDataService, user: Record<string, unknown>
const list = () => service.getStockSupplierFollowUps('u', 's1')
const launch = (version: string) => service.getStockSupplierChat('u', 's1', 'p1', version)
beforeEach(() => {
  provider = new Provider()
  user = { id: 'u', role: 'user', businessRole: 'salesperson', businessEmployeeId: 'e1', fopTenantId: 't', fopUserId: 'u', workbenchRoles: ['procurement'] }
  service = new FopDataService({ findById: async () => user } as unknown as UsersService, provider)
})
it('uses independently authorized stock orders and exposes only source-linked outstanding purchases', async () => {
  provider.contacts = [contact(), contact('p2'), { ...contact('foreign'), stockOrderId: 'other' }, { ...contact('denied') }]
  const page = await list()
  expect(page).toMatchObject({ source: 'mock', orderId: 's1', orderNumber: stock.stockNumber })
  expect(page.items.map((row: { purchaseOrderId: string }) => row.purchaseOrderId)).toEqual(['p1', 'p2'])
  expect(page.items[0].lines).toEqual([{ stockLineId: 'sl1', purchaseLineId: 'pl1', sku: 'SKU1', name: 'Lamp', pendingQuantity: 10 }])
  expect(page.items[0]).not.toHaveProperty('url')
  const result = await launch(page.items[0].contactVersion)
  expect(result).toMatchObject({ source: 'mock', mode: 'demo', url: null, orderId: 's1', purchaseOrderId: 'p1' })
})
it.each(['unpurchased', 'partial', 'in_progress', 'shipped', 'received'] as const)('rejects %s stock orders', async purchaseStatus => {
  provider.orders[0].purchaseStatus = purchaseStatus
  await expect(list()).rejects.toMatchObject({ status: 409 })
})
it('rejects foreign stock ownership and missing procurement access', async () => {
  provider.orders[0].owner.id = 'other'
  await expect(list()).rejects.toMatchObject({ status: 404 })
  provider.orders[0].owner.id = 'e1'; user.workbenchRoles = ['sales']
  await expect(list()).rejects.toMatchObject({ status: 403 })
})
it('rechecks purchase grants and stock shipment state after fetching contacts', async () => {
  provider.afterContacts = () => { provider.grant.allowedPurchaseOrderIds = [] }
  expect((await list()).items).toEqual([])
  provider.grant.allowedPurchaseOrderIds = ['p1']
  provider.afterContacts = () => { provider.orders[0].purchaseStatus = 'shipped' }
  await expect(list()).rejects.toMatchObject({ status: 409 })
})
it('blocks stale contact versions and unsafe chat URLs', async () => {
  const version = (await list()).items[0].contactVersion
  provider.contacts[0].supplier.wangwangAccount = 'changed'
  await expect(launch(version)).rejects.toMatchObject({ status: 409 })
  provider.contacts[0].chatUrl = 'https://evil.test/'
  const current = await list()
  expect(current.items[0].availability).toBe('chat_unavailable')
  await expect(launch(current.items[0].contactVersion)).rejects.toMatchObject({ status: 409 })
})

it('rejects unapproved, unpaid, cancelled, and revoked stock orders', async () => {
  for (const change of [{ reviewStatus: 'pending' }, { paymentStatus: 'unpaid' }, { cancelled: true }] as const) {
    provider.orders = [{ ...structuredClone(stock), ...change }]
    await expect(list()).rejects.toMatchObject({ status: 'cancelled' in change ? 404 : 409 })
  }
  provider.orders = [structuredClone(stock)]; provider.grant.allowedStockOrderIds = []
  await expect(list()).rejects.toMatchObject({ status: 404 })
})

it('reports an unconfigured adapter instead of pretending no purchase contacts exist', async () => {
  Object.defineProperty(provider, 'supportsStockSupplierFollowUp', { value: false })
  provider.grant.allowedPurchaseOrderIds = []
  await expect(list()).rejects.toMatchObject({ status: 503 })
})
