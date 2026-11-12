import { FopDataService } from './fop-data.service'
import { FopDataProvider } from './fop-data.types'
import { UsersService } from '../users/users.service'
import { FulfillmentOrdersController } from '../users/workbench.controller'
import { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'
import { FopApprovalService } from './fop-approval.service'
import { Request } from 'express'

function setup(source = 'fop') {
  const document = { id: 'r1', status: 'received', purchaseOrder: { id: 'p1', number: 'P1' }, supplier: { id: 's1', name: 'Supplier', wangwangAccount: 'seller' }, supplierChatUrl: 'aliim:sendmsg?touid=cnalichnseller' }
  const service = new FopDataService({} as UsersService, { source } as FopDataProvider)
  const read = jest.fn(async () => ({ rows: [{ id: 'o1', orderNumber: 'O1', purchaseReturns: [document] }] }))
  // The existing purchaseReturns method owns role, independent grants and current-source scope checks.
  Object.assign(service, { purchaseReturns: read })
  return { service, document, read }
}
it.each(['procurement', 'warehouse'] as const)('binds %s contact to the exact return/source and revalidates on launch', async workbenchRole => {
  const { service, read, document } = setup()
  const query = { orderId: 'o1', workbenchRole }
  const result = await service.getReturnSupplier('u1', 'r1', query)
  expect(read).toHaveBeenCalledWith('u1', { workbenchRole, paidAtOrder: 'desc' })
  const contactVersion = result.items[0].contactVersion
  expect(await service.getReturnSupplierChat('u1', 'r1', { ...query, contactVersion })).toMatchObject({ orderId: 'o1', purchaseOrderId: 'p1', mode: 'live', wangwangAccount: 'seller' })
  expect(read).toHaveBeenCalledTimes(2)
  document.supplier.wangwangAccount = 'changed'
  await expect(service.getReturnSupplierChat('u1', 'r1', { ...query, contactVersion })).rejects.toMatchObject({ response: { code: 'supplier_contact_changed' } })
})
it('rejects unrelated returns, hidden sources and revoked scope', async () => {
  const { service, read } = setup()
  const query = { orderId: 'o1', workbenchRole: 'warehouse' as const }
  await expect(service.getReturnSupplier('u1', 'other', query)).rejects.toMatchObject({ status: 404 })
  await expect(service.getReturnSupplier('u1', 'r1', { ...query, orderId: 'other' })).rejects.toMatchObject({ status: 404 })
  read.mockRejectedValueOnce(new Error('access revoked'))
  await expect(service.getReturnSupplier('u1', 'r1', query)).rejects.toThrow('access revoked')
})
it('reports missing accounts and never launches a demo chat', async () => {
  const { service, document } = setup('mock')
  const query = { orderId: 'o1', workbenchRole: 'procurement' as const }
  let result = await service.getReturnSupplier('u1', 'r1', query)
  expect(await service.getReturnSupplierChat('u1', 'r1', { ...query, contactVersion: result.items[0].contactVersion })).toMatchObject({ source: 'mock', mode: 'demo', url: null })
  document.supplier.wangwangAccount = ''; document.supplierChatUrl = ''
  result = await service.getReturnSupplier('u1', 'r1', query)
  expect(result.items[0].availability).toBe('missing_account')
  await expect(service.getReturnSupplierChat('u1', 'r1', { ...query, contactVersion: result.items[0].contactVersion })).rejects.toMatchObject({ response: { code: 'supplier_chat_unavailable' } })
})
it('routes real return contact and launch through dedicated realtime scope instead of local mirrors', async () => {
  const unavailableSupplier = jest.fn().mockRejectedValue(new Error('local contacts unavailable'))
  const getRealtimeSupplierContacts = jest.fn().mockResolvedValue({ source: 'fop', items: [] })
  const getRealtimeSupplierChat = jest.fn().mockResolvedValue({ source: 'fop', mode: 'live' })
  const controller = new FulfillmentOrdersController({ getRealtimeSupplierContacts, getRealtimeSupplierChat } as unknown as FopDataService, {} as FopApprovalService, { enabled: true, mock: false, unavailableSupplier } as unknown as LocalWorkbenchService)
  const req = { user: { userId: 'u1' } } as unknown as Request
  const query = { orderId: 'o1', workbenchRole: 'warehouse' as const, contactVersion: 'a'.repeat(64) }
  expect(await controller.getReturnSupplier(req, 'r1', query)).toMatchObject({ source: 'fop' })
  expect(await controller.getReturnSupplierChat(req, 'r1', query)).toMatchObject({ mode: 'live' })
  expect(getRealtimeSupplierContacts).toHaveBeenCalledWith('u1', { context: 'purchase_return', returnId: 'r1', orderId: 'o1', workbenchRole: 'warehouse' })
  expect(getRealtimeSupplierChat).toHaveBeenCalledWith('u1', { context: 'purchase_return', returnId: 'r1', orderId: 'o1', workbenchRole: 'warehouse' }, 'a'.repeat(64), undefined)
  expect(unavailableSupplier).not.toHaveBeenCalled()
})
it('routes fulfillment, stock and purchase group contacts through their exact realtime context', async () => {
  const getRealtimeSupplierContacts = jest.fn().mockResolvedValue({ source: 'fop', items: [] })
  const getRealtimeSupplierChat = jest.fn().mockResolvedValue({ source: 'fop', mode: 'live' })
  const controller = new FulfillmentOrdersController({ getRealtimeSupplierContacts, getRealtimeSupplierChat } as unknown as FopDataService, {} as FopApprovalService, { enabled: true, mock: false } as LocalWorkbenchService)
  const req = { user: { userId: 'u1' } } as unknown as Request
  const version = 'a'.repeat(64), filters = { queue: 'procurement_shipping' as const, departmentId: 'd1' }
  await controller.getSupplierFollowUps(req, 'o1', {})
  await controller.getSupplierChat(req, 'o1', 'p1', { contactVersion: version })
  await controller.getStockSupplierFollowUps(req, 's1')
  await controller.getStockSupplierChat(req, 's1', 'p2', { contactVersion: version })
  await controller.getPurchaseGroupSupplier(req, 'purchase:p3', filters)
  await controller.getPurchaseGroupSupplierChat(req, 'purchase:p3', { ...filters, contactVersion: version })
  expect(getRealtimeSupplierContacts.mock.calls).toEqual([
    ['u1', { context: 'fulfillment', orderId: 'o1', queue: 'procurement_shipping' }],
    ['u1', { context: 'stock', orderId: 's1', queue: 'procurement_shipping' }],
    ['u1', { context: 'purchase_group', groupId: 'purchase:p3', filters }],
  ])
  expect(getRealtimeSupplierChat.mock.calls).toEqual([
    ['u1', { context: 'fulfillment', orderId: 'o1', queue: 'procurement_shipping' }, version, 'p1'],
    ['u1', { context: 'stock', orderId: 's1', queue: 'procurement_shipping' }, version, 'p2'],
    ['u1', { context: 'purchase_group', groupId: 'purchase:p3', filters }, version, undefined],
  ])
})
it('does not use a real or generic provider to fill missing local mock contacts', async () => {
  const unavailableSupplier = jest.fn().mockRejectedValue(new Error('not configured'))
  const getRealtimeSupplierContacts = jest.fn()
  const controller = new FulfillmentOrdersController({ getRealtimeSupplierContacts } as unknown as FopDataService, {} as FopApprovalService, { enabled: true, mock: true, unavailableSupplier } as unknown as LocalWorkbenchService)
  const req = { user: { userId: 'u1' } } as unknown as Request
  await expect(controller.getReturnSupplier(req, 'r1', { orderId: 'o1', workbenchRole: 'warehouse' })).rejects.toThrow('not configured')
  expect(getRealtimeSupplierContacts).not.toHaveBeenCalled()
})
