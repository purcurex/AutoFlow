import { FulfillmentOrdersController } from './workbench.controller'
import { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'
import { ConfigService } from '@nestjs/config'

const req = { user: { userId: 'account', sessionVersion: 2 } } as any
describe('workbench query routing', () => {
  it.each([undefined, { enabled: false }])('fails closed for missing/disabled local replica and never invokes historical list APIs', async local => {
    const old = jest.fn(() => { throw new Error('historical source accessed') })
    const controller = new FulfillmentOrdersController({ getOrders: old, getRmaOrders: old, getStockOrders: old, exportOrders: old } as any, {} as any, local as any)
    await expect(controller.getOrders(req, { queue: 'review', page: 1, pageSize: 50 })).rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
    expect(() => controller.getRmaOrders(req, {} as any)).toThrow('local replica')
    expect(() => controller.getStockOrders(req, {} as any)).toThrow('local replica')
    await expect(controller.exportOrders(req, {} as any)).rejects.toMatchObject({ status: 503 })
    expect(old).not.toHaveBeenCalled()
  })
  it('uses dedicated real APIs for inventories but preserves the explicit local mock', async () => {
    const remote = jest.fn(async () => ({ marker: 'real-dedicated' })), mock = jest.fn(async () => ({ marker: 'mock' }))
    const data = { getAllocationInventory: remote, getStockInventory: remote, getStockCustomers: remote }
    const local = { enabled: true, mock: false, getAllocationInventory: mock, getStockInventory: mock, getStockCustomers: mock }
    const controller = new FulfillmentOrdersController(data as any, {} as any, local as any)
    expect(await controller.getAllocationInventory(req, {} as any)).toEqual({ marker: 'real-dedicated' })
    expect(await controller.getStockInventory(req, {} as any)).toEqual({ marker: 'real-dedicated' })
    expect(await controller.getStockCustomers(req, {} as any)).toEqual({ marker: 'real-dedicated' })
    local.mock = true
    expect(await controller.getAllocationInventory(req, {} as any)).toEqual({ marker: 'mock' })
    expect(await controller.getStockInventory(req, {} as any)).toEqual({ marker: 'mock' })
  })
  it.each([undefined, { enabled: false }])('uses dedicated contacts without reviving historical supplier traversal when the local replica is missing/disabled', async local => {
    const old = jest.fn(() => { throw new Error('historical supplier traversal accessed') })
    const dedicated = jest.fn(async () => ({ marker: 'real-dedicated-contacts' }))
    const controller = new FulfillmentOrdersController({ getSupplierFollowUps: old, getRealtimeSupplierContacts: dedicated } as any, {} as any, local as any)
    expect(await controller.getSupplierFollowUps(req, 'o1', {} as any)).toEqual({ marker: 'real-dedicated-contacts' })
    expect(dedicated).toHaveBeenCalledWith('account', { context: 'fulfillment', orderId: 'o1', queue: 'procurement_shipping' })
    expect(old).not.toHaveBeenCalled()
  })
  it('blocks every real export without source revalidation instead of falling through to old live exports', async () => {
    const old = jest.fn(() => { throw new Error('old live export reached') })
    const local = new LocalWorkbenchService({} as any, { findById: async () => ({ id: 'account', role: 'admin', sessionVersion: 2 }) } as any,
      new ConfigService({ WORKBENCH_READ_MODE: 'local', WORKBENCH_MOCK_ENABLED: 'false', FOP_QUERIES_PAUSED: 'true' }))
    const controller = new FulfillmentOrdersController({ exportOrders: old, exportStockOrders: old, exportRmaOrders: old, exportPurchaseReturns: old, exportPurchaseGroups: old } as any, {} as any, local)
    for (const method of ['exportOrders', 'exportStockOrders', 'exportRmaOrders', 'exportPurchaseReturns', 'exportPurchaseGroups'] as const) {
      await expect(controller[method](req, { mode: 'filtered' } as any)).rejects.toMatchObject({ response: { code: 'workbench_replica_export_revalidation_required' } })
    }
    expect(old).not.toHaveBeenCalled()
  })
})
