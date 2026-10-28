import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopPermissionGrant, FopOrderCandidate } from './fop-data.types'
import { AllocationInventoryScope } from './allocation-inventory'
import { demoAllocationScopes } from './allocation-inventory-demo'
import { UsersService } from '../users/users.service'
import { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
const order: FopOrderCandidate = {
  tenantId: 't', id: 'o1', orderNumber: 'TO261028000001', shopifyOrderNumber: '#1001', customerId: 'c1', customerName: 'Client', storeName: 'Store',
  items: [{ sku: 'SKU-1', name: 'Lamp', variant: 'Blue', imageUrl: null, quantity: 3 }], amount: 10, currency: 'USD',
  owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: 'YT',
  paymentStatus: 'paid', reviewStatus: 'approved', procurementStatus: 'pending', allocationStatus: 'pending', dispatchStatus: 'pending', shippingStatus: 'pending', carrier: null, trackingNumber: null, salesperson: 'Alice',
  createdAt: '2026-10-28T01:00:00Z', paidAt: '2026-10-28T01:00:00Z', cancelled: false, exception: null,
  allocationDocument: { id: 'a1', number: 'AO261028000001' },
  fulfillmentProgress: { allocationCreated: true, stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending', shopifySync: 'pending', supplierShipment: 'pending' },
}
class Provider extends FopDataProvider {
  orders = [structuredClone(order)]
  grant: FopPermissionGrant = { subject: { tenantId: 't', userId: 'u' }, allowedOrderIds: ['o1'], allocationInventoryScopes: demoAllocationScopes(this.orders) }
  isConfigured() { return true }
  async resolvePermissions() { return this.grant }
  async listOrders() { return this.orders }
  getAllocationInventory = jest.fn(async (_identity, _permission, scopes: readonly AllocationInventoryScope[]) => ({ subject: this.grant.subject, complete: true, asOf: '2026-10-28T01:00:00Z', items: scopes.filter(s => s.customer !== null).map(s => ({ scopeId: s.id, onHand: 8, occupied: 2 })) }))
}
const query: AllocationInventoryQueryDto = { mode: 'selected', orderIds: ['o1'], page: 1, pageSize: 50 }
let provider: Provider, user: Record<string, unknown>, service: FopDataService
beforeEach(() => {
  provider = new Provider()
  user = { id: 'u', role: 'admin', businessRole: 'salesperson', businessEmployeeId: 'e1', workbenchRoles: ['allocation'], fopTenantId: 't', fopUserId: 'u' }
  service = new FopDataService({ findById: async () => user } as unknown as UsersService, provider)
})
it('derives targets from current authorized incomplete orders, fills public zero, returns no private grant fields', async () => {
  const result = await service.getAllocationInventory('u', query)
  expect(result.total).toBe(2)
  expect(result.items.find(row => row.customer === null)).toMatchObject({ onHand: 0, occupied: 0, free: 0 })
  expect(result.items.find(row => row.customer !== null)).toMatchObject({ onHand: 8, occupied: 2, free: 6 })
  expect(result.items[1]).not.toHaveProperty('owner')
})
it('rejects unauthorized, no longer incomplete and cross-owner selections', async () => {
  for (const patch of [{ id: 'other' }, { owner: { id: 'other', name: 'Other' } }, { fulfillmentProgress: { ...order.fulfillmentProgress, stockReadiness: 'ready' as const } }]) {
    provider.orders = [{ ...order, ...patch }]
    await expect(service.getAllocationInventory('u', query)).rejects.toThrow()
  }
  expect(provider.getAllocationInventory).not.toHaveBeenCalled()
})
it('does not derive inventory authorization from an order grant or administrator UI role', async () => {
  provider.grant.allocationInventoryScopes = undefined
  await expect(service.getAllocationInventory('u', query)).rejects.toThrow()
  user.workbenchRoles = ['sales']
  await expect(service.getAllocationInventory('u', { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toThrow()
})
it('fails closed if employee scope changes during the inventory request', async () => {
  provider.getAllocationInventory.mockImplementationOnce(async () => { user.businessEmployeeId = 'other'; return { subject: provider.grant.subject, complete: true, asOf: '2026-10-28T01:00:00Z', items: [] } })
  await expect(service.getAllocationInventory('u', query)).rejects.toThrow()
})
it('rejects missing searches and conflicting input modes before calling providers', async () => {
  for (const q of [{ mode: 'search', search: ' ' }, { mode: 'selected', orderIds: [] }, { mode: 'search', search: 'SKU', orderIds: ['o1'] }, { mode: 'selected', orderIds: ['o1'], search: 'SKU' }]) await expect(service.getAllocationInventory('u', { ...query, ...q } as AllocationInventoryQueryDto)).rejects.toThrow()
  expect(provider.getAllocationInventory).not.toHaveBeenCalled()
})
it('validates public request limits, enums and paging', async () => {
  for (const patch of [{ orderIds: Array.from({ length: 101 }, (_, i) => String(i)) }, { orderIds: ['o1', 'o1'] }, { page: 0 }, { page: null }, { pageSize: null }, { warehouseCode: null }, { orderIds: [' '] }, { pageSize: 200 }, { warehouseCode: 'FOREIGN' }]) expect((await validate(plainToInstance(AllocationInventoryQueryDto, { ...query, ...patch }))).length).toBeGreaterThan(0)
})
