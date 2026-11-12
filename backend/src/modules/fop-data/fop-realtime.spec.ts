import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopDataService } from './fop-data.service'
import { FopDataProvider } from './fop-data.types'
import { FopApprovalService } from './fop-approval.service'

const identity = { tenantId: 'tenant', userId: '100' }
const currentScope = { actorAccountId: 'account', business: { role: 'admin', departmentId: null, employeeId: null }, employeeFilter: { employeeIds: null, version: 'local-v1' } }
const config: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://offline.test/legacy', FOP_KINGDEE_SUMMARY_URL: 'https://offline.test/legacy-summary', FOP_KINGDEE_TENANT_ID: 'tenant', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-token', FOP_KINGDEE_IDENTITY: 'offline-app',
  FOP_KINGDEE_CURRENT_INVENTORY_URL: 'https://offline.test/current', FOP_KINGDEE_RESERVED_INVENTORY_URL: 'https://offline.test/reserved',
  FOP_KINGDEE_SUPPLIER_CONTACTS_URL: 'https://offline.test/contacts', FOP_KINGDEE_SUPPLIER_CHAT_URL: 'https://offline.test/chat', FOP_KINGDEE_PHYSICAL_RETURN_ENTITY: 'confirmed_physical_return',
  FOP_KINGDEE_APPROVAL_CONTEXT_URL: 'https://offline.test/approval', FOP_KINGDEE_OPERATION_URL: 'https://offline.test/operation',
}
const envelope = (resource: string, result: unknown) => ({ schemaVersion: 1, subject: identity, organizationIds: ['10'], currentScope, resource,
  authorization: { resource, allowed: true, checkedAt: new Date().toISOString() }, result })
const page = { complete: true, asOf: new Date().toISOString(), items: [], total: 0, page: 1, pageSize: 50, selectedOrders: [] }
const reservedRow = (customerId = 'c1', sku = 'SKU-A', warehouseCode = 'HZ') => ({ tenantId: 'tenant', id: `${customerId}-${sku}-${warehouseCode}`, customerId, customerCode: customerId, customerName: customerId,
  owner: { id: 'e1', name: 'Sales' }, department: { id: 'd1', name: '业务一部' }, sku, name: 'Product', imageUrl: null, warehouseCode, warehouse: warehouseCode,
  fullPayment: { available: 8, locked: 2 }, deposit: { available: 3, locked: 1 } })
const setup = (value: unknown, overrides: Record<string, string | undefined> = {}) => {
  const request = jest.fn(async (_input?: unknown, _init?: RequestInit) => new Response(JSON.stringify({ status: true, errorCode: '0', data: value })))
  const provider = new KingdeeFopDataProvider({ get: key => ({ ...config, ...overrides })[key] }, request)
  return { provider: provider as any, request }
}
describe('dedicated realtime FOP boundaries (offline only)', () => {
  it('uses the independent current inventory API without querying old order lists', async () => {
    const { provider, request } = setup(envelope('current_inventory', page))
    const result = await provider.queryCurrentInventory(identity, currentScope, { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })
    expect(result).toMatchObject({ total: 0, source: 'fop' })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual(['https://offline.test/current'])
  })
  it.each([{ resource: 'orders' }, { authorization: { resource: 'current_inventory', allowed: false, checkedAt: new Date().toISOString() } }, { currentScope: { ...currentScope, actorAccountId: 'other' } }, { authorization: { resource: 'current_inventory', allowed: true, checkedAt: '2000-01-01T00:00:00Z' } }])('fails closed for unrelated, revoked or stale independent grant %j', async patch => {
    const { provider } = setup({ ...envelope('current_inventory', page), ...patch })
    await expect(provider.queryCurrentInventory(identity, currentScope, { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toThrow()
  })
  it('does not request anything if the dedicated API is missing, even with legacy QUERY_URL configured', async () => {
    const { provider, request } = setup({}, { FOP_KINGDEE_CURRENT_INVENTORY_URL: '' })
    await expect(provider.queryCurrentInventory(identity, currentScope, { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toMatchObject({ code: 'fop_current_inventory_not_configured' })
    expect(request).not.toHaveBeenCalled()
  })
  it('does not expose historical list/stock/RMA APIs through the production provider', async () => {
    const { provider, request } = setup({})
    await expect(provider.queryOrders(identity, { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'], organizationIds: ['10'] } }, currentScope.business, { queue: 'review', page: 1, pageSize: 50 })).rejects.toMatchObject({ code: 'fop_feature_not_configured' })
    await expect(provider.resolveStockPermissions(identity, currentScope.business)).rejects.toMatchObject({ code: 'fop_reserved_inventory_not_configured' })
    await expect(provider.queryRmaOrders(identity, { subject: identity, allowedOrderIds: [] }, currentScope.business)).rejects.toMatchObject({ code: 'fop_rma_not_configured' })
    expect(request).not.toHaveBeenCalled()
  })
  it('does not probe the old pending-review summary when independent analytics permissions are missing', async () => {
    const { provider, request } = setup({})
    await expect(provider.resolvePermissions(identity, currentScope.business)).rejects.toMatchObject({ code: 'fop_feature_not_configured' })
    expect(request).not.toHaveBeenCalled()
  })
  it('preserves the pause guard on all dedicated realtime APIs', async () => {
    const { provider, request } = setup({}, { FOP_QUERIES_PAUSED: 'true' })
    await expect(provider.queryCurrentInventory(identity, currentScope, { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toMatchObject({ code: 'fop_queries_paused' })
    expect(request).not.toHaveBeenCalled()
  })
  it('never retries a mutation on network errors or 5xx responses', async () => {
    for (const failure of [new Error('response lost'), new Response('', { status: 503 })]) {
      const { provider, request } = setup({})
      request.mockImplementation(async () => { if (failure instanceof Error) throw failure; return failure })
      await expect(provider.approveDocument(identity, { tenantId: 'tenant', orderId: 'o1', id: 'o1', number: 'TO1', entity: 'hzkj_orders', status: 'B', version: 'v1', eligible: true, reason: null,
        operation: 'audit', idempotencyKey: 'a'.repeat(64), requestId: 'request', actorAccountId: 'account', currentScope })).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(1)
    }
  })
  it('keeps selected customer/SKU pairs exact, permits authorized warehouses and preserves full-payment/deposit balances', async () => {
    const result = { ...page, total: 1, items: [reservedRow('c1', 'SKU-A', 'SZ')], selectedOrders: [{ id: 'o1', customerId: 'c1', warehouseCode: 'HZ', skus: ['SKU-A'], eligible: true }] }
    const { provider } = setup(envelope('reserved_inventory', result))
    const response = await provider.queryReservedInventory(identity, currentScope, { orderIds: ['o1'], page: 1, pageSize: 50 })
    expect(response.items[0]).toMatchObject({ customerId: 'c1', sku: 'SKU-A', warehouseCode: 'SZ', fullPayment: { available: 8, locked: 2, onHand: 10 }, deposit: { available: 3, locked: 1, onHand: 4 }, onHand: 14 })
  })
  it('does not cross-join selected customers and SKUs or accept incomplete selection proofs', async () => {
    const result = { ...page, total: 1, items: [reservedRow('c1', 'SKU-B')], selectedOrders: [
      { id: 'o1', customerId: 'c1', warehouseCode: 'HZ', skus: ['SKU-A'], eligible: true }, { id: 'o2', customerId: 'c2', warehouseCode: 'HZ', skus: ['SKU-B'], eligible: true }] }
    for (const selectedOrders of [result.selectedOrders, result.selectedOrders.slice(0, 1)]) {
      const { provider } = setup(envelope('reserved_inventory', { ...result, selectedOrders }))
      await expect(provider.queryReservedInventory(identity, currentScope, { orderIds: ['o1', 'o2'], page: 1, pageSize: 50 })).rejects.toThrow()
    }
  })
  it('uses the actor employee for unselected stock even when business visibility is administrative', async () => {
    const scoped = { ...currentScope, actorEmployeeId: 'e1' }
    const { provider } = setup({ ...envelope('reserved_inventory', { ...page, total: 1, items: [reservedRow()] }), currentScope: scoped })
    expect((await provider.queryReservedInventory(identity, scoped, { page: 1, pageSize: 50 })).total).toBe(1)
  })
  it('requires fresh complete realtime pages and never invents missing quantities', async () => {
    for (const result of [{ ...page, total: 1 }, { ...page, complete: false }, { ...page, asOf: '2000-01-01T00:00:00Z' }, { ...page, total: 1, items: [{ id: 'i1', sku: 'SKU', name: 'Product', warehouseCode: 'HZ', warehouse: 'Hangzhou', customer: null, onHand: 2 }] }]) {
      const { provider } = setup(envelope('current_inventory', result))
      await expect(provider.queryCurrentInventory(identity, currentScope, { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toThrow()
    }
  })
  it('only accepts current inventory pools for the exact selected customer, SKU and warehouse', async () => {
    const row = { id: 'i1', sku: 'SKU-A', name: 'Product', warehouseCode: 'HZ', warehouse: 'Hangzhou', customer: { id: 'c2', name: 'Other' }, onHand: 8, occupied: 2 }
    const { provider } = setup(envelope('current_inventory', { ...page, total: 1, items: [row], selectedOrders: [{ id: 'o1', customerId: 'c1', warehouseCode: 'HZ', skus: ['SKU-A'], eligible: true }] }))
    await expect(provider.queryCurrentInventory(identity, currentScope, { mode: 'selected', orderIds: ['o1'], page: 1, pageSize: 50 })).rejects.toThrow()
  })
  it('requires server-confirmed atomic checks and an exact idempotency receipt before declaring audit success', async () => {
    const command = { tenantId: 'tenant', orderId: 'o1', id: 'o1', number: 'TO1', entity: 'hzkj_orders', status: 'B', version: 'v1', eligible: true, reason: null,
      operation: 'audit', idempotencyKey: 'a'.repeat(64), requestId: 'request', actorAccountId: 'account', currentScope }
    const result = { atomicChecks: true, idempotencyKey: 'a'.repeat(64), requestId: 'request', documentId: 'o1', status: 'approved', message: '已审核', warning: null }
    for (const patch of [{ atomicChecks: false }, { idempotencyKey: 'b'.repeat(64) }, { documentId: 'other' }]) {
      const { provider } = setup(envelope('approval_operation', { ...result, ...patch }))
      await expect(provider.approveDocument(identity, command)).rejects.toThrow()
    }
    const { provider, request } = setup(envelope('approval_operation', result))
    expect(await provider.approveDocument(identity, command)).toEqual({ status: 'approved', message: '已审核', warning: null })
    const sent = JSON.parse(String(request.mock.calls[0][1]?.body))
    expect(sent.query).toMatchObject({ version: 'v1', idempotencyKey: 'a'.repeat(64), currentScope })
  })
  it('uses the dedicated approval context and refuses an unrelated action grant', async () => {
    const result = { action: 'review', actionAllowed: true, inQueue: true, order: { id: 'o1', orderNumber: 'TO1', allocationDocument: null, dispatchDocuments: [] },
      targets: [{ tenantId: 'tenant', orderId: 'o1', id: 'o1', number: 'TO1', entity: 'hzkj_orders', version: 'v1', status: 'B', eligible: true, reason: null }] }
    const { provider, request } = setup(envelope('approval_context', result))
    expect(await provider.readApprovalContext(identity, currentScope, 'review', 'o1')).toMatchObject({ inQueue: true, order: { orderNumber: 'TO1' }, targets: [{ version: 'v1' }] })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual(['https://offline.test/approval'])
    const denied = setup(envelope('approval_context', { ...result, actionAllowed: false }))
    await expect(denied.provider.readApprovalContext(identity, currentScope, 'review', 'o1')).rejects.toThrow()
  })
  it.each(['scope', 'subject', 'resource', 'expired', 'missing'])('treats a committed audit with an unconfirmed %s receipt as unknown and stops the rest of the batch', async invalid => {
    const receipt = envelope('approval_operation', { atomicChecks: true, idempotencyKey: 'will-be-filled-from-request', requestId: 'request', documentId: 'o1', status: 'approved', message: '已审核', warning: null }) as Record<string, any>
    if (invalid === 'scope') receipt.currentScope = { ...currentScope, actorAccountId: 'other' }
    if (invalid === 'subject') receipt.subject = { ...identity, userId: 'other' }
    if (invalid === 'resource') receipt.resource = 'current_inventory'
    if (invalid === 'expired') receipt.authorization.checkedAt = '2000-01-01T00:00:00Z'
    if (invalid === 'missing') delete receipt.subject
    const committed: string[] = []
    const request = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body))
      committed.push(query.id)
      receipt.result.idempotencyKey = query.idempotencyKey
      return new Response(JSON.stringify({ status: true, errorCode: '0', data: receipt }))
    })
    const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
    const data = { approvalContext: async (_user: string, _queue: string, id: string) => ({ identity, currentScope, inQueue: true,
      order: { id, orderNumber: `TO-${id}`, allocationDocument: null, dispatchDocuments: [] },
      targets: [{ tenantId: 'tenant', orderId: id, id, number: `TO-${id}`, entity: 'hzkj_orders', version: 'v1', status: 'B', eligible: true, reason: null }] }) }
    const service = new FopApprovalService(data as any, provider)
    const preview = await service.preview('account', { queue: 'review', orderIds: ['o1', 'o2'] })
    const result = await service.submit('account', { queue: 'review', requestId: 'request', items: preview.items.map(({ orderId, version }) => ({ orderId, version })) })
    expect(result.items.map(row => row.status)).toEqual(['unknown', 'blocked'])
    expect(committed).toEqual(['o1'])
  })
})

describe('real capability service isolation', () => {
  it('returns a dedicated not_configured error without any legacy permission or order read', async () => {
    class Provider extends FopDataProvider {
      isConfigured() { return true }
      async resolvePermissions(): Promise<any> { throw new Error('legacy permissions must not be used') }
      async listOrders(): Promise<any> { throw new Error('legacy order list must not be used') }
    }
    const service = new FopDataService({ findById: async () => ({ id: 'account', role: 'admin', businessRole: 'admin', fopTenantId: 'tenant', fopUserId: '100' }) } as any, new Provider())
    await expect(service.getAllocationInventory('account', { mode: 'search', search: 'SKU', page: 1, pageSize: 50 })).rejects.toMatchObject({ response: { code: 'fop_current_inventory_not_configured' } })
    await expect(service.approvalContext('account', 'review', 'o1')).rejects.toMatchObject({ response: { code: 'fop_approval_not_configured' } })
    await expect(service.getStockInventory('account', { page: 1, pageSize: 50 })).rejects.toMatchObject({ response: { code: 'fop_reserved_inventory_not_configured' } })
  })
})

const contact = { purchaseOrderId: 'p1', purchaseOrderNumber: 'P1', platformOrderNumber: null,
  supplier: { id: 's1', name: 'Supplier', wangwangAccount: 'seller' }, shipmentStatus: 'pending',
  lines: [{ fulfillmentLineId: 'l1', purchaseLineId: 'pl1', sku: 'SKU', name: 'Product', pendingQuantity: 2 }],
  paid: true, cancelled: false, availability: 'ready', contactVersion: 'a'.repeat(64) }
const followContext = { context: 'fulfillment', orderId: 'o1', queue: 'procurement_shipping' }
const contactResult = (context: any = followContext) => ({ source: 'fop', complete: true, context, orderId: context.groupId ?? context.orderId, orderNumber: 'O1', refreshedAt: new Date().toISOString(),
  sourceAuthorization: { resource: ({ fulfillment: 'orders', stock: 'stock_orders', purchase_group: 'purchase_orders', purchase_return: 'purchase_returns' } as any)[context.context], allowed: true, checkedAt: new Date().toISOString() },
  relationshipVerified: true, sourceEntity: context.context === 'purchase_return' ? 'confirmed_physical_return' : undefined,
  items: [{ ...contact, lines: context.context === 'stock' ? [{ stockLineId: 'sl1', purchaseLineId: 'pl1', sku: 'SKU', name: 'Product', pendingQuantity: 2 }] : context.context === 'fulfillment' ? contact.lines : [] }] })
describe('proposed dedicated supplier realtime adapter', () => {
  it.each([followContext, { context: 'stock', orderId: 's1', queue: 'procurement_shipping' },
    { context: 'purchase_group', groupId: 'purchase:p1', filters: { queue: 'procurement_shipping' } },
    { context: 'purchase_return', returnId: 'r1', orderId: 'o1', workbenchRole: 'warehouse' }])('returns only source-confirmed contacts for %j without legacy reads', async context => {
    const { provider, request } = setup(envelope('supplier_contacts', contactResult(context)))
    const result = await provider.querySupplierContacts(identity, currentScope, context)
    expect(result).toMatchObject({ source: 'fop', orderId: ('groupId' in context ? context.groupId : context.orderId), items: [{ contactVersion: 'a'.repeat(64) }] })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual(['https://offline.test/contacts'])
  })
  it.each([{ subject: { ...identity, userId: 'other' } }, { currentScope: { ...currentScope, actorAccountId: 'other' } },
    { resource: 'orders' }, { authorization: { resource: 'supplier_contacts', allowed: false, checkedAt: new Date().toISOString() } }])('rejects invalid contact identity/scope/grant %j', async patch => {
    const { provider } = setup({ ...envelope('supplier_contacts', contactResult()), ...patch })
    await expect(provider.querySupplierContacts(identity, currentScope, followContext)).rejects.toThrow()
  })
  it.each([{ context: { ...followContext, orderId: 'other' } }, { relationshipVerified: false },
    { sourceAuthorization: { resource: 'orders', allowed: false, checkedAt: new Date().toISOString() } },
    { sourceAuthorization: { resource: 'stock_orders', allowed: true, checkedAt: new Date().toISOString() } },
    { sourceAuthorization: { resource: 'orders', allowed: true, checkedAt: '2000-01-01T00:00:00Z' } },
    { items: [{ ...contact, lines: [] }] }])('rejects missing or unrelated source/contact proof %j', async patch => {
    const { provider } = setup(envelope('supplier_contacts', { ...contactResult(), ...patch }))
    await expect(provider.querySupplierContacts(identity, currentScope, followContext)).rejects.toThrow()
  })
  it('does not call upstream if the new endpoint or formal physical return entity is absent', async () => {
    for (const overrides of [{ FOP_KINGDEE_SUPPLIER_CONTACTS_URL: '' }, { FOP_KINGDEE_PHYSICAL_RETURN_ENTITY: '' }, { FOP_KINGDEE_PHYSICAL_RETURN_ENTITY: 'hzkj_purrefundapplybill' }]) {
      const { provider, request } = setup({}, overrides)
      await expect(provider.querySupplierContacts(identity, currentScope, { context: 'purchase_return', returnId: 'r1', orderId: 'o1', workbenchRole: 'warehouse' })).rejects.toMatchObject({ code: 'fop_supplier_contacts_not_configured' })
      expect(request).not.toHaveBeenCalled()
    }
  })
  it('revalidates the exact supplier contact version and only returns whitelisted launch URLs', async () => {
    const query = { ...followContext, purchaseOrderId: 'p1', contactVersion: 'a'.repeat(64) }
    const result = { ...contactResult(), mode: 'live', purchaseOrderId: 'p1', contactVersion: 'a'.repeat(64), wangwangAccount: 'seller', url: 'aliim:sendmsg?touid=cnalichnseller' }
    const { provider } = setup(envelope('supplier_chat', result))
    expect(await provider.launchSupplierChat(identity, currentScope, query)).toMatchObject({ source: 'fop', mode: 'live', purchaseOrderId: 'p1', url: 'aliim:sendmsg?touid=cnalichnseller' })
    for (const patch of [{ purchaseOrderId: 'other' }, { contactVersion: 'v2' }, { url: 'https://evil.test' }, { wangwangAccount: 'changed' }]) {
      const bad = setup(envelope('supplier_chat', { ...result, ...patch }))
      await expect(bad.provider.launchSupplierChat(identity, currentScope, query)).rejects.toThrow()
    }
  })
})
describe('reserved customer completeness', () => {
  it.each([101, 200])('rejects truncated customer candidates with %i total and actionable search error', async total => {
    const { provider } = setup(envelope('reserved_inventory', { complete: true, items: Array.from({ length: 100 }, (_, n) => ({ id: String(n), code: String(n), name: `Customer ${n}` })), total }))
    await expect(provider.queryReservedCustomers(identity, currentScope, {})).rejects.toMatchObject({ code: 'fop_reserved_customers_search_required' })
  })
  it('accepts a complete narrowed customer search and rejects a truncated result below 100', async () => {
    const { provider } = setup(envelope('reserved_inventory', { complete: true, items: [{ id: 'c1', code: 'C1', name: 'Customer' }], total: 1 }))
    expect(await provider.queryReservedCustomers(identity, currentScope, { search: 'C1' })).toMatchObject({ total: 1 })
    const truncated = setup(envelope('reserved_inventory', { complete: true, items: [], total: 2 }))
    await expect(truncated.provider.queryReservedCustomers(identity, currentScope, {})).rejects.toMatchObject({ code: 'fop_reserved_customers_search_required' })
  })
})

describe('supplier realtime service isolation', () => {
  const account = { id: 'account', role: 'admin', businessRole: 'admin', fopTenantId: 'tenant', fopUserId: '100' }
  it('checks current account scope again after reading contacts and never resolves legacy permissions', async () => {
    let user = { ...account }
    class Provider extends FopDataProvider {
      isConfigured() { return true }
      async resolvePermissions(): Promise<any> { throw new Error('legacy grant must not be used') }
      async listOrders(): Promise<any> { throw new Error('legacy list must not be used') }
      async querySupplierContacts(): Promise<any> { user = { ...user, fopUserId: 'changed' }; return contactResult() }
    }
    const service = new FopDataService({ findById: async () => user } as any, new Provider()) as any
    await expect(service.getRealtimeSupplierContacts('account', followContext)).rejects.toMatchObject({ status: 403 })
  })
  it('returns a dedicated missing-source error instead of historical contacts', async () => {
    class Provider extends FopDataProvider {
      isConfigured() { return true }
      async resolvePermissions(): Promise<any> { throw new Error('legacy grant must not be used') }
      async listOrders(): Promise<any> { throw new Error('legacy list must not be used') }
    }
    const service = new FopDataService({ findById: async () => account } as any, new Provider()) as any
    await expect(service.getRealtimeSupplierContacts('account', followContext)).rejects.toMatchObject({ response: { code: 'fop_supplier_contacts_not_configured' } })
  })
})

describe('supplier completeness and queue facts', () => {
  it.each([{ contactVersion: 'opaque-but-unusable-in-existing-launch-dto' }, { paid: false }, { cancelled: true }, { shipmentStatus: 'shipped' }])('rejects contacts that cannot be safely used in the pending purchase workflow %j', async patch => {
    const { provider } = setup(envelope('supplier_contacts', { ...contactResult(), items: [{ ...contact, ...patch }] }))
    await expect(provider.querySupplierContacts(identity, currentScope, followContext)).rejects.toThrow()
  })
  it('applies the pause guard to contact list and launch without requesting any endpoint', async () => {
    const { provider, request } = setup({}, { FOP_QUERIES_PAUSED: 'true' })
    await expect(provider.querySupplierContacts(identity, currentScope, followContext)).rejects.toMatchObject({ code: 'fop_queries_paused' })
    await expect(provider.launchSupplierChat(identity, currentScope, { ...followContext, purchaseOrderId: 'p1', contactVersion: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'fop_queries_paused' })
    expect(request).not.toHaveBeenCalled()
  })
})

describe('supplier response completeness and request serialization', () => {
  it('refuses an incomplete contact response instead of exposing a partial supplier list', async () => {
    const { provider } = setup(envelope('supplier_contacts', { ...contactResult(), complete: false }))
    await expect(provider.querySupplierContacts(identity, currentScope, followContext)).rejects.toThrow()
  })
  it('compares the canonical HTTP query so absent optional filter fields do not reject a valid response', async () => {
    const context = { context: 'purchase_group', groupId: 'purchase:p1', filters: { queue: 'procurement_shipping', search: undefined, ownerId: undefined } }
    const echoed = { context: 'purchase_group', groupId: 'purchase:p1', filters: { queue: 'procurement_shipping' } }
    const { provider } = setup(envelope('supplier_contacts', contactResult(echoed)))
    expect(await provider.querySupplierContacts(identity, currentScope, context)).toMatchObject({ orderId: 'purchase:p1' })
  })
})
describe('supplier launch service revalidation', () => {
  it.each(['version', 'account', 'scope'])('blocks a changed %s without exposing an obsolete launch link', async changed => {
    let user = { id: 'account', role: 'admin', businessRole: 'admin', fopTenantId: 'tenant', fopUserId: '100' }, launched = 0
    class Provider extends FopDataProvider {
      isConfigured() { return true }
      async resolvePermissions(): Promise<any> { throw new Error('legacy grant must not be used') }
      async listOrders(): Promise<any> { throw new Error('legacy list must not be used') }
      async querySupplierContacts(): Promise<any> { return contactResult() }
      async launchSupplierChat(): Promise<any> {
        launched++
        if (changed === 'scope') user = { ...user, fopUserId: 'other' }
        return { source: 'fop', mode: 'live', orderId: 'o1', purchaseOrderId: 'p1', wangwangAccount: changed === 'account' ? 'changed' : 'seller', url: 'aliim:sendmsg?touid=cnalichnseller' }
      }
    }
    const service = new FopDataService({ findById: async () => user } as any, new Provider()) as any
    await expect(service.getRealtimeSupplierChat('account', followContext, (changed === 'version' ? 'b' : 'a').repeat(64), 'p1')).rejects.toMatchObject({ status: changed === 'scope' ? 403 : 409 })
    expect(launched).toBe(changed === 'version' ? 0 : 1)
  })
})

it('shows the same narrowing requirement when FOP explicitly marks an over-limit customer result incomplete', async () => {
  const { provider } = setup(envelope('reserved_inventory', { complete: false, items: [], total: 101 }))
  await expect(provider.queryReservedCustomers(identity, currentScope, {})).rejects.toMatchObject({ code: 'fop_reserved_customers_search_required' })
})
it('does not launch or fall back if the proposed dedicated launch URL is missing', async () => {
  const { provider, request } = setup({}, { FOP_KINGDEE_SUPPLIER_CHAT_URL: '' })
  await expect(provider.launchSupplierChat(identity, currentScope, { ...followContext, purchaseOrderId: 'p1', contactVersion: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'fop_supplier_contacts_not_configured' })
  expect(request).not.toHaveBeenCalled()
})
