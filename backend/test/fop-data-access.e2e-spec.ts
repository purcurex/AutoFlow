import { demoAllocationScopes } from '../src/modules/fop-data/allocation-inventory-demo'
import { FopProfitCandidate } from '../src/modules/fop-data/sales-performance.types'
import { FopFreightCandidate } from '../src/modules/fop-data/fop-freight.types'
import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import * as request from 'supertest'
import * as ExcelJS from 'exceljs'
import { UsersModule } from '../src/modules/users/users.module'
import { User, UserRole } from '../src/modules/users/user.entity'
import { JwtStrategy } from '../src/modules/auth/jwt.strategy'
import { FopIntegrationController } from '../src/modules/fop-integration/fop-integration.controller'
import { FopIntegrationService } from '../src/modules/fop-integration/fop-integration.service'
import { FopLogisticsCatalogPort, FopProductCostPort } from '../src/modules/fop-integration/fop-integration.types'
import { FopReceiptCandidate } from '../src/modules/fop-data/fop-data.types'

describe('FOP user isolation HTTP API (repository and provider boundaries stubbed)', () => {
  let app: INestApplication
  let jwt: JwtService
  let accounts: Map<string, any>
  let provider: any
  let records: any[]
  let receiptRecords: FopReceiptCandidate[]
  let freightRecords: FopFreightCandidate[]
  let profitRecords: FopProfitCandidate[]
  const alice = '88f90288-6d52-4d0b-bd10-549e4ac937a1'
  const bob = '88f90288-6d52-4d0b-bd10-549e4ac937b2'
  const token = (id: string) => jwt.sign({ userId: id, role: 'admin' })
  const get = (path: string, id = alice) => request(app.getHttpServer()).get(`/api${path}`).auth(token(id), { type: 'bearer' })
  const bind = (body: object, actor = bob, target = alice) => request(app.getHttpServer())
    .put(`/api/users/${target}/fop-binding`).auth(token(actor), { type: 'bearer' }).send(body)
  const list = (query = 'queue=review', id = alice) => get(`/autoflow/integrations/fop/fulfillment-orders?${query}`, id)
  const dashboard = (id = alice, extra = '') => get(`/autoflow/integrations/fop/dashboard?from=2020-01-01&to=2020-01-31&year=2020${extra}`, id)
  const access = (id = alice) => get('/autoflow/integrations/fop/data-access', id)
  const order = (id: string, extra = {}) => ({
    procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid' },
    fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
    owner: { id: 'alice-owner', name: 'Alice' }, tenantId: 'tenant-1', id, orderNumber: id.toUpperCase(), shopifyOrderNumber: `#${id}`, customerName: `Customer ${id}`,
    storeName: `Store ${id}`, items: [{ sku: id, name: id, imageUrl: null, variant: '', quantity: 1 }],
    amount: 10, currency: 'USD', paymentStatus: 'paid', reviewStatus: 'pending', procurementStatus: 'pending',
    allocationStatus: 'pending', dispatchStatus: 'not_ready', shippingStatus: 'not_ready', warehouse: '杭州仓', warehouseCode: 'HZ',
    carrier: '云途YT', carrierCode: 'YT', trackingNumber: null, salesperson: id, createdAt: '2020-01-10T00:00:00Z', paidAt: '2020-01-10T00:00:00Z', cancelled: false,
    exception: null, ...extra,
  })
  const receipt = (id: string, extra: Partial<FopReceiptCandidate> = {}): FopReceiptCandidate => ({
    tenantId: 'tenant-1', id, sourceType: 'fulfillment', documentId: `order-${id}`, documentNumber: `ORDER-${id}`,
    customerId: id, customerCode: `C-${id}`, customerName: `Customer ${id}`,
    owner: { id: 'alice-owner', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, salesDepartmentCode: 'sales1', departmentPathIds: ['d1'],
    organization: { id: 'org-1', name: 'HyperZone' }, warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: 'YT',
    amount: 8, orderAmount: 10, handlingFee: 2, currency: 'USD', paidAt: '2020-01-10T00:00:00Z',
    paymentStatus: 'paid', reviewStatus: 'approved', receiptReviewStatus: 'approved', cancelled: false,
    items: [{ sku: 'sku-1', name: 'Product', imageUrl: null, variant: '', quantity: 1 }], ...extra,
  })

  it('serves independently authorized current inventory and rejects invalid, stale and denied queries over HTTP', async () => {
    accounts.get(alice).workbenchRoles = ['allocation']
    records = [order('inventory-order', { customerId: 'c1', reviewStatus: 'approved', department: { id: 'd1', name: '业务一部' } })]
    const scopes = demoAllocationScopes(records)
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(o => o.id), allocationInventoryScopes: scopes })
    provider.getAllocationInventory = async (subject: any) => ({ subject, complete: true, asOf: '2026-10-28T01:00:00Z', items: [] })
    const post = (body: object) => request(app.getHttpServer()).post('/api/autoflow/integrations/fop/allocation-inventory/query').auth(token(alice), { type: 'bearer' }).send(body)
    const selected = { mode: 'selected', orderIds: ['inventory-order'] }
    const response = await post(selected).expect(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.body.items).toHaveLength(2)
    expect(response.body.items.every((r: any) => r.onHand === 0 && r.free === 0)).toBe(true)
    await post({ mode: 'search', search: 'inventory' }).expect(200)
    for (const body of [{ mode: 'search', search: ' ' }, { ...selected, search: 'bad' }, { ...selected, orderIds: ['inventory-order', 'inventory-order'] }, { ...selected, warehouseCode: 'BAD' }, { ...selected, tenantId: 'spoof' }]) await post(body).expect(400)
    provider.getAllocationInventory = async (subject: any) => ({ subject, complete: false, asOf: '2026-10-28T01:00:00Z', items: [] })
    await post(selected).expect(503)
    records[0].fulfillmentProgress.stockReadiness = 'ready'
    await post(selected).expect(409)
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [] })
    await post({ mode: 'search', search: 'inventory' }).expect(403)
    await request(app.getHttpServer()).post('/api/autoflow/integrations/fop/allocation-inventory/query').send(selected).expect(401)
  })

  it('projects and sorts only actual procurement review timestamps with nulls last before pagination', async () => {
    accounts.get(alice).workbenchRoles = ['procurement', 'sales']
    records = [
      order('early', { reviewStatus: 'approved', reviewedAt: '2026-10-28T08:00:00+08:00' }),
      order('late', { reviewStatus: 'approved', reviewedAt: '2026-10-28T01:00:00Z' }),
      order('invalid', { reviewStatus: 'approved', reviewedAt: '2026-02-30T00:00:00Z' }),
      order('missing', { reviewStatus: 'approved' }),
      order('pending', { reviewedAt: '2025-01-01T00:00:00Z' }),
    ]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(o => o.id) })
    const asc = (await list('queue=procurement&sortBy=reviewedAt&sortOrder=asc').expect(200)).body
    expect(asc.items.map((r: any) => r.id)).toEqual(['early', 'late', 'invalid', 'missing', 'pending'])
    expect(asc.items[0].reviewedAt).toBe('2026-10-28T00:00:00.000Z')
    expect(asc.items.slice(2).map((r: any) => r.reviewedAt)).toEqual([null, null, null])
    const desc = (await list('queue=procurement&sortBy=reviewedAt&sortOrder=desc&pageSize=1').expect(200)).body
    expect(desc.items[0].id).toBe('late'); expect(desc.total).toBe(5)
    await list('queue=review&sortBy=reviewedAt').expect(400)
  })

  it('returns WMS push instants without creation fallback and keeps unpushed warehouse tasks visible', async () => {
    accounts.get(alice).workbenchRoles = ['warehouse']
    const ready = { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'approved', outbound: 'pending' }
    const row = (id: string, wmsCreatedAt?: unknown, extra = {}) => order(id, { reviewStatus: 'approved', fulfillmentProgress: ready, wmsCreatedAt, ...extra })
    records = [row('valid', '2026-10-28T12:30:00+08:00'), row('missing'), row('invalid', '2026-02-30T00:00:00Z'), row('no-zone', '2026-10-28T12:30:00'), row('foreign', '2026-10-28T00:00:00Z', { owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(o => o.id) })
    const result = (await list('queue=shipping').expect(200)).body
    expect(Object.fromEntries(result.items.map((o: any) => [o.id, o.wmsCreatedAt]))).toEqual({ valid: '2026-10-28T04:30:00.000Z', missing: null, invalid: null, 'no-zone': null })
    expect(result.total).toBe(4)
  })

  it('returns current allocation completion time and clears it after release while retaining scope', async () => {
    accounts.get(alice).workbenchRoles = ['allocation']
    const ready = { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'pending', outbound: 'pending' }
    const row = (id: string, allocationReadyAt?: unknown, extra = {}) => order(id, { reviewStatus: 'approved', fulfillmentProgress: ready, allocationReadyAt, ...extra })
    records = [row('valid', '2026-10-27T12:30:00+08:00'), row('missing'), row('invalid', '2026-02-30T00:00:00Z'), row('no-zone', '2026-10-27T12:30:00'), row('foreign', '2026-10-27T00:00:00Z', { owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(o => o.id) })
    const result = (await list('queue=allocation_review').expect(200)).body
    expect(Object.fromEntries(result.items.map((o: any) => [o.id, o.allocationReadyAt]))).toEqual({ valid: '2026-10-27T04:30:00.000Z', missing: null, invalid: null, 'no-zone': null })
    records[0].fulfillmentProgress = { ...ready, stockReadiness: 'incomplete' }
    const released = (await list('queue=allocation').expect(200)).body
    expect(released.items[0].allocationReadyAt).toBeNull()
  })

  it('normalizes actual supplier payment time without creation or receipt fallback and retains scope', async () => {
    accounts.get(alice).workbenchRoles = ['procurement']
    const paid = { procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder: 'pushed' } }
    records = [order('valid', { ...paid, procurementPaidAt: '2026-10-27T12:30:00+08:00' }), order('missing', paid),
      order('invalid', { ...paid, procurementPaidAt: '2026-02-30T00:00:00Z' }), order('no-zone', { ...paid, procurementPaidAt: '2026-10-27T12:30:00' }),
      order('foreign', { ...paid, procurementPaidAt: '2026-10-20T00:00:00Z', owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(o => o.id) })
    const result = (await list('queue=procurement_shipping').expect(200)).body
    expect(Object.fromEntries(result.items.map((o: any) => [o.id, o.procurementPaidAt]))).toEqual({ valid: '2026-10-27T04:30:00.000Z', missing: null, invalid: null, 'no-zone': null })
    expect(result.total).toBe(4)
    expect(result.items.every((o: any) => o.paidAt === '2020-01-10T00:00:00Z')).toBe(true)
  })

  it('returns only typed logistics facts within their carrier group and authorized order', async () => {
    const logisticsInfo = [{ carrierName: ' 云途YT ', secret: 'rate', shopifyTracking: { type: 'first_mile', number: ' JSEJX2881622244YQ ', secret: 'rate' }, trackingNumbers: [
      { type: 'full', number: ' YT-FULL ', cost: 9 }, { type: 'first_mile', number: 'YT-FIRST' },
      { type: 'last_mile', number: '9400' }, { type: 'full', number: 'YT-FULL' },
      { type: 'guessed', number: 'NOT-A-FACT' }, { type: 'full', number: 42 } ] },
      { carrierName: '4PX', shopifyTracking: { type: 'last_mile', number: '0000123' }, trackingNumbers: [{ type: 'full', number: 'NOT-SELECTED' }] },
      { carrierName: 'JS', shopifyTracking: { type: 'full', number: 'JS-FULL' } },
      { carrierName: 'Invalid', shopifyTracking: { type: 'guessed', number: 'BAD' } },
      { carrierName: 42, trackingNumbers: null }]
    records = [order('a', { logisticsInfo }), order('outside', { logisticsInfo, owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a', 'outside'] })
    const response = (await list().expect(200)).body
    expect(response.items.map((row: any) => row.id)).toEqual(['a'])
    expect(response.items[0].logisticsInfo).toEqual([
      { carrierName: '云途YT', shopifyTracking: { type: 'first_mile', number: 'JSEJX2881622244YQ' } },
      { carrierName: '4PX', shopifyTracking: { type: 'last_mile', number: '0000123' } },
      { carrierName: 'JS', shopifyTracking: { type: 'full', number: 'JS-FULL' } },
      { carrierName: 'Invalid', shopifyTracking: null },
    ])
    records = [order('a', { logisticsInfo: { carrierName: 'invalid' }, trackingNumber: 'LEGACY' })]
    expect((await list().expect(200)).body.items[0]).toMatchObject({ logisticsInfo: null, trackingNumber: 'LEGACY' })
  })

  it('searches unpaid custom channel names before pagination and totals without carrier substitution', async () => {
    const unpaid = { paymentStatus: 'unpaid', paidAt: null, department: { id: 'd1', name: '业务一部' }, customLogisticsChannelName: ' Priority Shipping ' }
    records = [order('a', { ...unpaid, amount: 10 }), order('b', { ...unpaid, amount: 20 }), order('sz', { ...unpaid, warehouseCode: 'SZ' }),
      order('carrier-only', { ...unpaid, customLogisticsChannelName: undefined, carrier: 'Priority Express' }),
      order('invalid', { ...unpaid, customLogisticsChannelName: 42 }),
      order('actual-only', { ...unpaid, customLogisticsChannelName: 'Economy', logisticsChannels: [{ name: 'Priority', code: 'P' }] }),
      order('outside', { ...unpaid, owner: { id: 'other', name: 'Other' } }), order('no-grant', unpaid)]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'no-grant').map(row => row.id) })
    const response = (await list('queue=unpaid&search=%20PRIORITY%20&warehouseCode=HZ&departmentId=d1&pageSize=1').expect(200)).body
    expect(response.items.map((row: any) => row.id)).toEqual(['a'])
    expect(response.items[0].customLogisticsChannelName).toBe('Priority Shipping')
    expect(response.total).toBe(2)
    expect(response.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 30 }])
    expect((await list('queue=unpaid&search=' + encodeURIComponent('sHiPpInG')).expect(200)).body.total).toBe(3)
    expect((await list('queue=unpaid&search=YT').expect(200)).body.total).toBe(0)
    const legacy = (await list('queue=unpaid&orderNumber=CARRIER-ONLY').expect(200)).body.items[0]
    expect(legacy.customLogisticsChannelName).toBeNull()
    expect((await list('queue=unpaid&orderNumber=INVALID').expect(200)).body.items[0].customLogisticsChannelName).toBeNull()
  })

  it('returns normalized order destination countries and leaves unknown legacy destinations empty', async () => {
    records = [order('us', { shippingCountryCode: ' us ' }), order('gb', { shippingCountryCode: 'GB' }), order('missing'), order('invalid', { shippingCountryCode: 'ZZ' }), order('foreign', { shippingCountryCode: 'AU', owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const response = (await list().expect(200)).body
    expect(Object.fromEntries(response.items.map((row: any) => [row.id, row.shippingCountryCode]))).toEqual({ us: 'US', gb: 'GB', missing: null, invalid: null })
  })

  it('allowlists actual logistics channel names and codes after order authorization', async () => {
    const channels = [{ name: ' 云途标准专线 ', code: ' YT-STD ', privateRate: 99 }, { name: '云途标准专线', code: 'YT-STD' }, { name: '云途带电专线', code: 'YT-BAT' }]
    records = [order('own', { logisticsChannels: channels }), order('legacy'), order('invalid', { logisticsChannels: { name: 'invalid' } }), order('partial', { logisticsChannels: [{ name: ' 渠道名称 ', code: 42 }, { name: null, code: 'CODE-ONLY' }, { name: ' ', code: {} }, null] }), order('foreign', { logisticsChannels: channels, owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const response = (await list().expect(200)).body
    expect(Object.fromEntries(response.items.map((row: any) => [row.id, row.logisticsChannels]))).toEqual({
      own: [{ name: '云途标准专线', code: 'YT-STD' }, { name: '云途带电专线', code: 'YT-BAT' }], legacy: null, invalid: null,
      partial: [{ name: '渠道名称', code: null }, { name: null, code: 'CODE-ONLY' }],
    })
  })

  it('returns only authorized order recipient fields, normalizes blanks and excludes profile/private data', async () => {
    const recipient = { name: ' Jane Smith ', phone: ' +1 202-555-0147 ', email: 'jane@example.com', city: 'Boston', state: 'MA', postalCode: '02108', addressLine1: '18 Example Street', addressLine2: ' ', privateNote: 'never expose' }
    records = [order('own', { shippingRecipient: recipient } as any), order('legacy'), order('invalid', { shippingRecipient: { name: 42, phone: {} } } as any), order('foreign', { shippingRecipient: { ...recipient, name: 'Foreign recipient' }, owner: { id: 'other', name: 'Other' } } as any)]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const response = (await list().expect(200)).body
    expect(response.items.map((row: any) => row.id)).not.toContain('foreign')
    expect(response.items.find((row: any) => row.id === 'own').shippingRecipient).toEqual({ name: 'Jane Smith', phone: '+1 202-555-0147', email: 'jane@example.com', city: 'Boston', state: 'MA', postalCode: '02108', addressLine1: '18 Example Street', addressLine2: null })
    expect(response.items.find((row: any) => row.id === 'legacy').shippingRecipient).toBeNull()
    expect(response.items.find((row: any) => row.id === 'invalid').shippingRecipient).toBeNull()
    expect(JSON.stringify(response)).not.toContain('never expose')
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [] })
    expect((await list().expect(200)).body.items).toEqual([])
  })

  it.each(['unpaid', 'review', 'exceptions', 'dispatch'])('returns distinct consumer payment time for %s without fulfillment-date fallback', async queue => {
    accounts.get(alice).workbenchRoles = ['sales', 'dispatch']
    const unpaid = (id: string, value?: unknown, extra = {}) => order(id, { paymentStatus: queue === 'unpaid' ? 'unpaid' : 'paid', paidAt: queue === 'unpaid' ? null : '2026-10-03T00:00:00Z', reviewStatus: ['dispatch', 'allocation'].includes(queue) ? 'approved' : 'pending', exception: queue === 'exceptions' ? { reason: 'stock', hours: 1 } : null, consumerPaidAt: value, ...extra } as any)
    records = [unpaid('valid', '2026-10-01T17:30:00-04:00'), unpaid('missing'), unpaid('invalid', '2026-02-30T12:00:00Z'), unpaid('no-zone', '2026-10-01T17:30:00'), unpaid('foreign', '2026-10-01T00:00:00Z', { owner: { id: 'other', name: 'Other' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const response = (await list(`queue=${queue}`).expect(200)).body
    expect(Object.fromEntries(response.items.map((row: any) => [row.id, row.consumerPaidAt]))).toEqual({ valid: '2026-10-01T21:30:00.000Z', missing: null, invalid: null, 'no-zone': null })
    const own = response.items.find((row: any) => row.id === 'valid')
    expect(own.paidAt).toBe(queue === 'unpaid' ? null : '2026-10-03T00:00:00Z')
    expect(own.createdAt).toBe('2020-01-10T00:00:00Z')
  })

  describe('supplier follow-up', () => {
    const base = '/autoflow/integrations/fop/fulfillment-orders/o1/supplier-follow-ups'
    const purchase = (id: string, extra: any = {}) => ({
      tenantId: 'tenant-1', fulfillmentOrderId: 'o1', purchaseOrderId: id, purchaseOrderNumber: `PO-${id}`, platformOrderNumber: '1688-001',
      supplier: { id: `s-${id}`, name: `Supplier ${id}`, wangwangAccount: `卖家${id}` },
      chatUrl: `aliim:sendmsg?touid=${encodeURIComponent(`cnalichn卖家${id}`)}`,
      paid: true, cancelled: false, shipmentStatus: 'pending',
      lines: [{ fulfillmentLineId: 'line-o1', purchaseLineId: `line-${id}`, sku: 'o1', name: 'Product', pendingQuantity: 2 }], ...extra,
    })
    function prepare(items: any[]) {
      accounts.get(alice).workbenchRoles = ['procurement']
      records = [order('o1', { reviewStatus: 'approved', procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['o1'], allowedPurchaseOrderIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] })
      provider.listSupplierFollowUps = async (subject: any) => ({ subject, orderId: 'o1', items })
    }
    it('returns only authorized effective purchases linked to this order and launches the exact seller', async () => {
      prepare([purchase('p1'), purchase('p2'), purchase('p3', { cancelled: true }), purchase('p4', { paid: false }), purchase('p5', { shipmentStatus: 'shipped' }), purchase('p6', { fulfillmentOrderId: 'another' }), purchase('private')])
      const result = await get(base).expect(200)
      expect(result.headers['cache-control']).toBe('private, no-store')
      expect(result.body.items.map((p: any) => p.purchaseOrderId)).toEqual(['p1', 'p2'])
      expect(result.body.items[0]).toMatchObject({ supplier: { wangwangAccount: '卖家p1' }, availability: 'ready', lines: [{ pendingQuantity: 2 }] })
      expect(JSON.stringify(result.body)).not.toContain('chatUrl')
      expect(JSON.stringify(result.body)).not.toContain('tenant-1')
      const launch = await get(`${base}/p2/launch?contactVersion=${result.body.items[1].contactVersion}`).expect(200)
      expect(launch.body).toMatchObject({ mode: 'live', purchaseOrderId: 'p2', wangwangAccount: '卖家p2', url: 'aliim:sendmsg?touid=cnalichn%E5%8D%96%E5%AE%B6p2' })
      await get(`${base}/private/launch?contactVersion=${result.body.items[0].contactVersion}`).expect(404)
      await get(base + '?userId=bob').expect(400)
      accounts.get(alice).workbenchRoles = ['sales']
      await get(base).expect(403)
      accounts.get(alice).workbenchRoles = ['procurement']
      records[0].owner.id = 'another-owner'
      await get(base).expect(404)
    })
    it('rejects changed sellers, completed orders and unsafe or missing chat destinations', async () => {
      const items = [purchase('p1'), purchase('p2', { supplier: { id: 's2', name: 'No account', wangwangAccount: null } }), purchase('p3', { chatUrl: 'javascript:alert(1)' }), purchase('p4', { chatUrl: 'aliim:sendmsg?touid=cnalichnWRONG' })]
      prepare(items)
      const first = (await get(base).expect(200)).body
      expect(first.items.map((p: any) => p.availability)).toEqual(['ready', 'missing_account', 'chat_unavailable', 'chat_unavailable'])
      for (const p of first.items.slice(1)) await get(`${base}/${p.purchaseOrderId}/launch?contactVersion=${p.contactVersion}`).expect(409)
      items[0].supplier.wangwangAccount = 'changed'
      await get(`${base}/p1/launch?contactVersion=${first.items[0].contactVersion}`).expect(409)
      records[0].fulfillmentProgress.supplierShipment = 'shipped'
      await get(base).expect(409)
    })
    it('rechecks revoked permissions while contacts are loading and hides completed source lines', async () => {
      prepare([purchase('p1')])
      const original = provider.listSupplierFollowUps
      provider.listSupplierFollowUps = async (identity: any) => {
        const result = await original(identity)
        provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['o1'], allowedPurchaseOrderIds: [] })
        return result
      }
      expect((await get(base).expect(200)).body.items).toEqual([])
      prepare([purchase('p1', { shipmentStatus: 'partial', lines: [
        { fulfillmentLineId: 'a', purchaseLineId: 'pa', sku: 'A', name: 'Pending', pendingQuantity: 1 },
        { fulfillmentLineId: 'b', purchaseLineId: 'pb', sku: 'B', name: 'Shipped', pendingQuantity: 0 },
      ] }), purchase('p2', { tenantId: 'other' })])
      const page = (await get(base).expect(200)).body
      expect(page.items).toHaveLength(1)
      expect(page.items[0].lines.map((line: any) => line.sku)).toEqual(['A'])
      await get(`${base}/p1/launch?contactVersion=x`).expect(400)
      await get(`${base}/p1/launch?contactVersion=${page.items[0].contactVersion}&supplierId=wrong`).expect(400)
    })
    it('does not derive purchase permission from order access and rejects wrong-subject provider responses', async () => {
      prepare([purchase('p1')])
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['o1'] })
      expect((await get(base).expect(200)).body.items).toEqual([])
      prepare([purchase('p1')])
      provider.listSupplierFollowUps = async () => ({ subject: { tenantId: 'other', userId: 'other' }, orderId: 'o1', items: [purchase('p1')] })
      await get(base).expect(503)
    })
  })

  beforeAll(async () => {
    const repository = {
      manager: { getRepository: () => ({ find: async () => [] }) },
      findOne: async ({ where }: any) => {
        const found = [...accounts.values()].find((account) => Object.entries(where).every(([key, value]) => account[key] === value))
        return found ? structuredClone(found) : null
      },
      update: async (id: string, changes: any) => {
        if (changes.fopUserId && [...accounts.values()].some((account) => account.id !== id && account.fopTenantId === changes.fopTenantId && account.fopUserId === changes.fopUserId)) {
          throw { driverError: { code: '23505' } }
        }
        Object.assign(accounts.get(id), changes)
      },
      findAndCount: async () => [[...accounts.values()], accounts.size],
    }
    const module = await Test.createTestingModule({
      imports: [UsersModule, JwtModule.register({ secret: 'fop-isolation-tests' })],
      controllers: [FopIntegrationController],
      providers: [
        JwtStrategy, { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: 'fop-isolation-tests' }) },
        { provide: FopIntegrationService, useValue: {} },
        { provide: FopProductCostPort, useValue: { getProductCosts: () => ({ secretCost: 1 }) } },
        { provide: FopLogisticsCatalogPort, useValue: { getCustomChannels: () => ['secret-channel'], getActualChannels: () => ['secret-channel'] } },
      ],
    }).overrideProvider(getRepositoryToken(User)).useValue(repository)
      .overrideProvider('FOP_DATA_PROVIDER').useValue({
        source: 'fop',
        approvalTargets: (identity: any, queue: any, orderId: string) => provider.approvalTargets(identity, queue, orderId),
        approveDocument: (identity: any, command: any) => provider.approveDocument(identity, command),
        isConfigured: () => provider.isConfigured(),
        listStockOrders: (identity: any, grant: any) => provider.listStockOrders(identity, grant),
        listStockInventory: (identity: any, grant: any) => provider.listStockInventory(identity, grant),
        getAllocationInventory: (identity: any, grant: any, scopes: any) => provider.getAllocationInventory(identity, grant, scopes),
        resolvePermissions: (identity: any) => provider.resolvePermissions(identity),
        listOrders: (identity: any, grant: any) => provider.listOrders(identity, grant),
        listSupplierFollowUps: (identity: any, grant: any, orderId: string) => provider.listSupplierFollowUps(identity, grant, orderId),
        listReceipts: (identity: any, grant: any) => provider.listReceipts(identity, grant),
        listFreight: (identity: any, grant: any) => provider.listFreight(identity, grant),
        listProfits: (identity: any, grant: any) => provider.listProfits(identity, grant),
        getAnalytics: (identity: any, grant: any, range: any) => provider.getAnalytics(identity, grant, range),
        getOrganizationSummary: (identity: any, grant: any, query: any) => provider.getOrganizationSummary(identity, grant, query),
      }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    jwt = module.get(JwtService)
    await app.init()
  })

  beforeEach(() => {
    accounts = new Map([
      [alice, { id: alice, displayId: '000001', email: 'alice@example.test', username: 'Alice', businessRole: 'salesperson', businessEmployeeId: 'alice-owner', password: 'secret', role: UserRole.USER, workbenchRoles: ['sales', 'allocation'], fopTenantId: 'tenant-1', fopUserId: 'alice-fop' }],
      [bob, { id: bob, displayId: '000002', email: 'bob@example.test', username: 'Bob', password: 'secret', role: UserRole.ADMIN, businessRole: 'admin', workbenchRoles: [], fopTenantId: 'tenant-1', fopUserId: 'bob-fop' }],
    ])
    records = [order('a', { exception: { reason: 'stock', hours: 20 } }), order('b'), order('shared', { reviewStatus: 'approved' }), order('outside'), order('a', { tenantId: 'other-tenant', customerName: 'OTHER TENANT SECRET' })]
    receiptRecords = []
    freightRecords = []
    profitRecords = []
    provider = {
      isConfigured: () => true,
      resolvePermissions: async (identity: any) => ({ subject: { ...identity }, allowedOrderIds: identity.userId === 'alice-fop' ? ['a', 'shared'] : ['b', 'shared'] }),
      listOrders: async () => structuredClone(records),
      listReceipts: async () => structuredClone(receiptRecords),
      listFreight: async () => structuredClone(freightRecords),
      listProfits: async () => structuredClone(profitRecords),
      getAnalytics: async (subject: any) => ({ subject, rates: [], registrations: [], registrationEntries: [] }),
      getOrganizationSummary: async () => { throw new Error('Summary adapter is not configured') },
    }
  })
  afterAll(async () => { await app?.close() })

  it('serves stock APIs with independent resource grants, strict filters and no-store responses', async () => {
    const stock = { tenantId: 'tenant-1', id: 'stock-1', stockNumber: 'BH261028000001', stockType: 'deposit', customerId: 'c1', customerCode: 'C1', customerName: 'Client', storeName: null, owner: { id: 'alice-owner', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, departmentPathIds: ['d1'], salesDepartmentCode: 'sales1', items: [{ sku: 'sku1', name: 'Product', imageUrl: null, variant: '', quantity: 20 }], amount: 90, currency: 'USD', paidAt: null, purchaseStatus: 'received', warehouseCode: 'HZ', warehouse: '杭州仓', cancelled: false }
    provider.listStockOrders = async () => [stock, { ...stock, id: 'outside', owner: { id: 'other', name: 'Other' } }]
    provider.listStockInventory = async () => [{ ...stock, id: 'inventory-1', sku: 'sku1', name: 'Product', imageUrl: null, fullPayment: { available: 12, locked: 3 }, deposit: { available: 7, locked: 2 } }]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [], allowedStockOrderIds: ['stock-1', 'outside'], allowedStockInventoryIds: ['inventory-1'] })
    const base = '/autoflow/integrations/fop'
    const response = await get(`${base}/stock-orders`).expect(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.body.total).toBe(1); expect(response.body.pageSize).toBe(50)
    expect(response.body.items[0]).toMatchObject({ stockType: 'deposit', paidAt: null, purchaseStatus: 'received' })
    await get(`${base}/stock-orders?pageSize=21`).expect(400)
    await get(`${base}/stock-orders?warehouseCode=OTHER`).expect(400)
    await get(`${base}/stock-orders?stockType=invalid`).expect(400)
    expect((await get(`${base}/stock-inventory`).expect(200)).body.total).toBe(1)
    await get(`${base}/stock-inventory?customerId=`).expect(400)
    expect((await get(`${base}/stock-inventory?customerSearch=cli&search=SKU`).expect(200)).body.total).toBe(1)
    expect((await get(`${base}/stock-inventory?customerSearch=missing`).expect(200)).body.total).toBe(0)
    await get(`${base}/stock-orders?queue=invalid`).expect(400)
    accounts.get(alice).workbenchRoles = ['procurement']
    expect((await get(`${base}/stock-orders?queue=procurement`).expect(200)).body.total).toBe(0)
    Object.assign(stock, { paymentStatus: 'paid', reviewStatus: 'approved', purchaseStatus: 'partial' })
    expect((await get(`${base}/stock-orders?queue=procurement`).expect(200)).body.total).toBe(1)
    accounts.get(alice).workbenchRoles = ['sales']
    expect((await get(`${base}/stock-inventory?customerId=c1`).expect(200)).body.items[0].onHand).toBe(24)
    expect((await get(`${base}/stock-inventory?customerId=other`).expect(200)).body.total).toBe(0)
    expect((await get(`${base}/stock-customers?search=Client`).expect(200)).body.items).toEqual([{ id: 'c1', code: 'C1', name: 'Client' }])
    accounts.get(alice).workbenchRoles = ['warehouse']
    await get(`${base}/stock-orders`).expect(403)
  })

  describe('workbench Excel export', () => {
    const exportOrders = (body: object, actor = alice) => request(app.getHttpServer())
      .post('/api/autoflow/integrations/fop/fulfillment-orders/export').auth(token(actor), { type: 'bearer' }).send(body).buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
        response.on('error', callback)
      })
    async function workbook(response: request.Response) {
      const result = new ExcelJS.Workbook()
      await result.xlsx.load(response.body)
      return result.getWorksheet('订单清单')!
    }
    it('filters procurement progress before paging and totals and uses the same scope for both exports', async () => {
      accounts.get(alice).workbenchRoles = ['procurement']
      const pending = { purchaseOrder: 'ordered', supplierPayment: 'unpaid', purchaseApplication: 'created', alibabaOrder: 'pushed', logisticsGate: 'satisfied' }
      records = [order('pay-a', { procurementProgress: pending }), order('pay-b', { procurementProgress: pending }),
        order('push', { procurementProgress: { ...pending, alibabaOrder: 'not_pushed' } }),
        order('other-owner', { procurementProgress: pending, owner: { id: 'other', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const page = (await list('queue=procurement&procurementStage=payment_pending&pageSize=1').expect(200)).body
      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(1)
      expect(page.totals.orderCount).toBe(2)
      const all = await workbook(await exportOrders({ queue: 'procurement', procurementStage: 'payment_pending', mode: 'filtered' }).expect(200))
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(JSON.stringify(all.getSheetValues())).not.toMatch(/PUSH|OTHER-OWNER/)
      const selected = await workbook(await exportOrders({ queue: 'procurement', procurementStage: 'payment_pending', mode: 'selected', orderIds: ['pay-b'] }).expect(200))
      expect(selected.getCell('A2').value).toBe('PAY-B')
      await exportOrders({ queue: 'procurement', procurementStage: 'payment_pending', mode: 'selected', orderIds: ['push'] }).expect(409)
      await list('queue=review&procurementStage=payment_pending').expect(400)
      await list('queue=procurement&procurementStage=invalid').expect(400)
      await list('queue=procurement&procurementStage=payment_pending&procurementStage=alibaba_pending').expect(400)
      await exportOrders({ queue: 'review', procurementStage: 'payment_pending', mode: 'filtered' }).expect(400)
    })
    it('filters compact task status before paging and totals and uses the same scope for both exports', async () => {
      accounts.get(alice).workbenchRoles = ['procurement']
      const pending = { purchaseOrder: 'ordered', supplierPayment: 'unpaid', purchaseApplication: 'created', alibabaOrder: 'pushed', logisticsGate: 'satisfied' }
      records = [order('pay-a', { procurementProgress: pending }), order('pay-b', { procurementProgress: pending }),
        order('push', { procurementProgress: { ...pending, alibabaOrder: 'not_pushed' } }),
        order('other-owner', { procurementProgress: pending, owner: { id: 'other', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const page = (await list('queue=procurement&taskStatus=payment_pending&pageSize=1').expect(200)).body
      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(1)
      expect(page.totals.orderCount).toBe(2)
      const all = await workbook(await exportOrders({ queue: 'procurement', taskStatus: 'payment_pending', mode: 'filtered' }).expect(200))
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(JSON.stringify(all.getSheetValues())).not.toMatch(/PUSH|OTHER-OWNER/)
      const selected = await workbook(await exportOrders({ queue: 'procurement', taskStatus: 'payment_pending', mode: 'selected', orderIds: ['pay-b'] }).expect(200))
      expect(selected.getCell('A2').value).toBe('PAY-B')
      await exportOrders({ queue: 'procurement', taskStatus: 'payment_pending', mode: 'selected', orderIds: ['push'] }).expect(409)
      await list('queue=review&taskStatus=payment_pending').expect(400)
      await list('queue=procurement&taskStatus=invalid').expect(400)
      await list('queue=procurement&taskStatus=payment_pending&taskStatus=alibaba_pending').expect(400)
      await exportOrders({ queue: 'review', taskStatus: 'payment_pending', mode: 'filtered' }).expect(400)
    })
    it('rejects removed procurement filters in lists and exports without dropping legacy unpaid tasks', async () => {
      accounts.get(alice).workbenchRoles = ['procurement']
      const pending = { purchaseOrder: 'ordered', supplierPayment: 'partial', purchaseApplication: 'created', alibabaOrder: 'pushed', logisticsGate: 'satisfied' }
      records = [order('legacy-unpaid', { procurementProgress: pending }), order('push-unknown', { procurementProgress: { ...pending, supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate: 'unknown' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      for (const status of ['partially_paid', 'logistics_unknown', 'unknown', 'application_pending', 'dispatch_missing', 'logistics_pending', 'supplier_pending']) {
        await list(`queue=procurement&taskStatus=${status}`).expect(400)
        await exportOrders({ queue: 'procurement', taskStatus: status, mode: 'filtered' }).expect(400)
      }
      await list('queue=procurement&procurementStage=partially_paid').expect(400)
      expect((await list('queue=procurement&taskStatus=payment_pending').expect(200)).body.items.map((o: any) => o.id)).toEqual(['legacy-unpaid'])
      expect((await list('queue=procurement&taskStatus=alibaba_pending').expect(200)).body.items.map((o: any) => o.id)).toEqual(['push-unknown'])
      const exported = await workbook(await exportOrders({ queue: 'procurement', mode: 'filtered' }).expect(200))
      expect(JSON.stringify(exported.getRow(1).values)).toContain('采购进度')
    })
    it('merges dispatch preparation facts in scoped lists and both exports while keeping paid shipment tasks separate', async () => {
      accounts.get(alice).workbenchRoles = ['procurement']
      const pending = { purchaseOrder: 'ordered', supplierPayment: 'unpaid', purchaseApplication: 'created', alibabaOrder: 'not_pushed', logisticsGate: 'pending_dispatch' }
      records = [order('missing', { procurementProgress: pending }),
        order('tracking', { procurementProgress: { ...pending, logisticsGate: 'pending_logistics' } }),
        order('prepared', { procurementProgress: { ...pending, purchaseOrder: 'not_ordered', purchaseApplication: 'not_created' } }),
        order('paid', { procurementProgress: { ...pending, supplierPayment: 'paid', alibabaOrder: 'pushed' } }),
        order('other', { procurementProgress: pending, owner: { id: 'other-owner', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const page = (await list('queue=procurement&taskStatus=dispatch_preparation&pageSize=1').expect(200)).body
      expect(page.total).toBe(2); expect(page.totals.orderCount).toBe(2); expect(page.items).toHaveLength(1)
      const all = await workbook(await exportOrders({ queue: 'procurement', taskStatus: 'dispatch_preparation', mode: 'filtered' }).expect(200))
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(JSON.stringify(all.getSheetValues())).toContain('待制作发运单')
      const selected = await workbook(await exportOrders({ queue: 'procurement', taskStatus: 'dispatch_preparation', mode: 'selected', orderIds: ['tracking'] }).expect(200))
      expect(selected.getCell('A2').value).toBe('TRACKING')
      await exportOrders({ queue: 'procurement', taskStatus: 'dispatch_preparation', mode: 'selected', orderIds: ['other'] }).expect(409)
      expect((await list('queue=procurement&taskStatus=purchase_order_pending').expect(200)).body.items.map((o: any) => o.id)).toEqual(['prepared'])
      expect((await list('queue=procurement_shipping').expect(200)).body.items.map((o: any) => o.id)).toEqual(['paid'])
      expect((await list('queue=procurement').expect(200)).body.items.map((o: any) => o.id)).not.toContain('paid')
    })
    it('filters allocation dispatch completion and exports trusted allocation references without losing incomplete tasks', async () => {
      accounts.get(alice).workbenchRoles = ['allocation']
      const ready = { ...order('base').fulfillmentProgress, stockReadiness: 'ready' }
      const make = (id: string, status: string, extra = {}) => order(id, { reviewStatus: 'approved', fulfillmentProgress: ready,
        allocationDocument: { id: `ao-${id}`, number: `AO261028000${id.charCodeAt(0)}`, privateMetadata: 'DO NOT LEAK' }, dispatchDocuments: [{ id: `fy-${id}`, number: `FY-${id}`, status }], ...extra })
      records = [make('a', 'approved'), make('b', 'approved', { fulfillmentProgress: { ...ready, shopifySync: 'synced' } }), make('c', 'submitted'), make('other', 'approved', { owner: { id: 'other', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const page = (await list('queue=allocation_review&taskStatus=dispatch_complete&pageSize=1').expect(200)).body
      expect(page.total).toBe(2); expect(page.totals.orderCount).toBe(2)
      expect(page.items[0].allocationDocument).toEqual({ id: 'ao-a', number: 'AO26102800097' })
      expect(JSON.stringify(page)).not.toContain('DO NOT LEAK')
      expect((await list('queue=allocation_review&taskStatus=dispatch_incomplete').expect(200)).body.items.map((row: any) => row.id)).toEqual(['c'])
      expect((await list('queue=allocation_review').expect(200)).body.total).toBe(3)
      const all = await workbook(await exportOrders({ queue: 'allocation_review', taskStatus: 'dispatch_complete', mode: 'filtered' }).expect(200))
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(JSON.stringify(all.getSheetValues())).toContain('配货单号')
      expect(JSON.stringify(all.getSheetValues())).toContain('AO26102800098')
      const selected = await workbook(await exportOrders({ queue: 'allocation_review', taskStatus: 'dispatch_complete', mode: 'selected', orderIds: ['b'] }).expect(200))
      expect(selected.getCell('A2').value).toBe('B')
      await exportOrders({ queue: 'allocation_review', taskStatus: 'dispatch_complete', mode: 'selected', orderIds: ['c'] }).expect(409)
      await list('queue=allocation_review&taskStatus=dispatch_approved').expect(400)
      records[0].allocationDocument = { id: 'bad', number: '' }
      await list('queue=allocation_review').expect(503)
    })
    it('rejects array-shaped allocation references and shared allocation IDs after scoping', async () => {
      accounts.get(alice).workbenchRoles = ['allocation']
      const reference = { id: 'ao1', number: 'AO261028000404' }
      const ready = { ...order('base').fulfillmentProgress, stockReadiness: 'ready' }
      const make = (id: string, allocationDocument: unknown, extra = {}) => order(id, { reviewStatus: 'approved', fulfillmentProgress: ready, allocationDocument, ...extra })
      records = [make('a', [reference])]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      await list('queue=allocation_review').expect(503)
      records = [make('a', reference), make('b', reference)]
      await list('queue=allocation_review').expect(503)
      // An out-of-scope row cannot affect visible data or disclose its relationship.
      records[1].owner = { id: 'other-owner', name: 'Other' }
      expect((await list('queue=allocation_review').expect(200)).body.total).toBe(1)
      records = [make('a', null)]
      const missing = (await list('queue=allocation_review').expect(200)).body
      expect(missing.total).toBe(1)
      expect(missing.items[0].allocationDocument).toBeNull()
    })
    it('keeps approved unsynced dispatches pending and removes them from lists, counts and exports after sync', async () => {
      accounts.get(alice).workbenchRoles = ['dispatch']
      const ready = { reviewStatus: 'approved', dispatchDocuments: [{ id: 'd1', number: '000001', status: 'approved' }] }
      const synced = { ...order('base').fulfillmentProgress, shopifySync: 'synced' }
      records = [order('pending-a', { ...ready, amount: 10 }), order('pending-b', { ...ready, amount: 20 }),
        order('draft', { ...ready, dispatchDocuments: [{ id: 'd2', number: '000002', status: 'draft' }] }),
        order('synced', { ...ready, fulfillmentProgress: synced }),
        order('other-owner', { ...ready, owner: { id: 'other', name: 'Other' } }), order('no-grant', ready),
        order('cancelled', { ...ready, cancelled: true }), order('unreviewed', { ...ready, reviewStatus: 'pending' }),
        order('unpaid', { ...ready, paymentStatus: 'unpaid' })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'no-grant').map(row => row.id) })
      expect((await list('queue=dispatch').expect(200)).body.items.map((row: { id: string }) => row.id)).toEqual(['draft', 'pending-a', 'pending-b'])
      const result = (await list('queue=dispatch&taskStatus=dispatch_approved&pageSize=1').expect(200)).body
      expect(result.total).toBe(2)
      expect(result.items.map((row: any) => row.id)).toEqual(['pending-a'])
      expect(result.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 30 }])
      expect((await dashboard().expect(200)).body.queues.dispatch).toBe(3)
      const all = await workbook(await exportOrders({ queue: 'dispatch', taskStatus: 'dispatch_approved', mode: 'filtered' }).expect(200))
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(all.getCell('G2').value).toBe('000001')
      expect(all.getCell('H2').value).toBe('已审核未同步')
      expect((await workbook(await exportOrders({ queue: 'dispatch', taskStatus: 'dispatch_approved', mode: 'selected', orderIds: ['pending-b'] }).expect(200))).getCell('A2').value).toBe('PENDING-B')
      for (const status of ['dispatch_synced', 'unknown']) {
        await list(`queue=dispatch&taskStatus=${status}`).expect(400)
        await exportOrders({ queue: 'dispatch', taskStatus: status, mode: 'filtered' }).expect(400)
      }
      for (const id of ['synced', 'other-owner', 'no-grant']) {
        await exportOrders({ queue: 'dispatch', mode: 'selected', orderIds: [id] }).expect(409)
      }
      records.find(row => row.id === 'pending-a')!.fulfillmentProgress = synced
      expect((await list('queue=dispatch&taskStatus=dispatch_approved').expect(200)).body.items.map((row: any) => row.id)).toEqual(['pending-b'])
      expect((await dashboard().expect(200)).body.queues.dispatch).toBe(2)
      await exportOrders({ queue: 'dispatch', mode: 'selected', orderIds: ['pending-a'] }).expect(409)
    })
    it.each(['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'])('sorts %s consumer payment time before paging and both export modes, retaining scope and nulls last', async queue => {
      accounts.get(alice).workbenchRoles = ['sales', 'dispatch', 'allocation']
      const fact = { paymentStatus: queue === 'unpaid' ? 'unpaid' : 'paid', reviewStatus: ['dispatch', 'allocation'].includes(queue) ? 'approved' : 'pending', exception: queue === 'exceptions' ? { reason: 'stock', hours: 1 } : null, department: { id: 'd1', name: '业务一部' } }
      const row = (id: string, consumerPaidAt: unknown, extra = {}) => order(id, { ...fact, consumerPaidAt, ...extra })
      records = [row('new', '2026-10-03T00:00:00Z'), row('tie-b', '2026-10-02T08:00:00+08:00'), row('old', '2026-10-01T00:00:00Z'), row('tie-a', '2026-10-02T00:00:00Z'), row('y-missing', undefined), row('z-invalid', '2026-02-30T00:00:00Z'),
        row('private', '2010-01-01T00:00:00Z'), row('foreign', '2010-01-01T00:00:00Z', { owner: { id: 'other', name: 'Other' } }), row('other-dept', '2010-01-01T00:00:00Z', { department: { id: 'd2', name: '业务二部' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(r => r.id !== 'private').map(r => r.id) })
      const filters = { queue, departmentId: 'd1', sortBy: 'consumerPaidAt' }
      const query = `queue=${queue}&departmentId=d1&sortBy=consumerPaidAt`
      const asc = (await list(query + '&sortOrder=asc').expect(200)).body
      expect(asc.items.map((r: any) => r.id)).toEqual(['old', 'tie-a', 'tie-b', 'new', 'y-missing', 'z-invalid'])
      const desc = (await list(query + '&sortOrder=desc').expect(200)).body
      expect(desc.items.map((r: any) => r.id)).toEqual(['new', 'tie-a', 'tie-b', 'old', 'y-missing', 'z-invalid'])
      expect(desc.totals).toEqual(asc.totals)
      expect(desc.total).toBe(6)
      expect((await list(query + '&sortOrder=desc&pageSize=1&page=2').expect(200)).body.items[0].id).toBe('tie-a')
      const sheet = await workbook(await exportOrders({ ...filters, sortOrder: 'asc', mode: 'filtered' }).expect(200))
      expect([2, 3, 4, 5, 6, 7].map(i => sheet.getCell(`A${i}`).value)).toEqual(['OLD', 'TIE-A', 'TIE-B', 'NEW', 'Y-MISSING', 'Z-INVALID'])
      const selected = await workbook(await exportOrders({ ...filters, sortOrder: 'desc', mode: 'selected', orderIds: ['old', 'new'] }).expect(200))
      expect([selected.getCell('A2').value, selected.getCell('A3').value]).toEqual(['NEW', 'OLD'])
      await exportOrders({ ...filters, mode: 'selected', orderIds: ['foreign'] }).expect(409)
      await list('queue=procurement&sortBy=consumerPaidAt').expect(400)
    })

    it('exports the same unpaid custom-channel filtered set across pages and selections', async () => {
      const unpaid = { paymentStatus: 'unpaid', paidAt: null, customLogisticsChannelName: 'Priority Shipping' }
      records = [order('a', unpaid), order('b', unpaid), order('carrier-only', { ...unpaid, customLogisticsChannelName: null, carrier: 'Priority Shipping' }), order('hidden', { ...unpaid, owner: { id: 'other', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const all = await workbook(await exportOrders({ queue: 'unpaid', mode: 'filtered', search: 'pRiOrItY' }).expect(200))
      expect(all.getCell('A2').value).toBe('A')
      expect(all.getCell('A3').value).toBe('B')
      expect(all.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect((await workbook(await exportOrders({ queue: 'unpaid', mode: 'selected', search: 'pRiOrItY', orderIds: ['b'] }).expect(200))).getCell('A2').value).toBe('B')
      await exportOrders({ queue: 'unpaid', mode: 'selected', search: 'pRiOrItY', orderIds: ['carrier-only'] }).expect(409)
      await exportOrders({ queue: 'unpaid', mode: 'selected', search: 'pRiOrItY', orderIds: ['hidden'] }).expect(409)
    })
    it('exports warehouse and carrier filters with permission checks and rejects stale selections', async () => {
      records = [order('hz', { warehouseCode: 'HZ' }), order('sz', { warehouseCode: 'SZ', warehouse: '深圳仓' }), order('other', { carrier: '4PX', carrierCode: '4PX' }), order('hidden', { owner: { id: 'other-owner', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const all = await workbook(await exportOrders({ queue: 'review', mode: 'filtered', warehouseCode: 'HZ', search: 'YT' }).expect(200))
      expect(all.getCell('A2').value).toBe('HZ')
      expect(all.getCell('A3').value).toBe('合计 · 1 笔订单')
      await exportOrders({ queue: 'review', mode: 'selected', warehouseCode: 'HZ', search: 'YT', orderIds: ['sz'] }).expect(409)
      await exportOrders({ queue: 'review', mode: 'selected', warehouseCode: 'HZ', search: 'YT', orderIds: ['hidden'] }).expect(409)
      await exportOrders({ queue: 'review', mode: 'filtered', warehouseCode: 'invalid' }).expect(400)
    })
    it('exports all filtered pages in list order, retaining only authorized tenant and employee records', async () => {
      records = Array.from({ length: 121 }, (_, i) => order(`all-${String(i).padStart(3, '0')}`, { department: { id: 'd1', name: '业务一部' }, paidAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() }))
      records.push(order('all-foreign', { tenantId: 'foreign', department: { id: 'd1', name: '业务一部' } }), order('all-other-owner', { owner: { id: 'other', name: 'Other' }, department: { id: 'd1', name: '业务一部' } }), order('all-other-dept', { department: { id: 'd2', name: '业务二部' } }))
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const response = await exportOrders({ queue: 'review', mode: 'filtered', departmentId: 'd1', search: 'ALL-', paidAtOrder: 'desc' }).expect(200)
      expect(response.headers['content-type']).toContain('spreadsheetml.sheet')
      expect(response.headers['content-disposition']).toContain("filename*=UTF-8''")
      expect(response.headers['cache-control']).toBe('private, no-store')
      const sheet = await workbook(response)
      expect(sheet.getCell('A2').value).toBe('ALL-120')
      expect(sheet.getCell('A122').value).toBe('ALL-000')
      expect(sheet.getCell('A123').value).toBe('合计 · 121 笔订单')
      expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/foreign|other-owner|other-dept|tenant-1/)
    })
    it('exports selected records only, and rejects stale, out-of-filter or unauthorized selections atomically', async () => {
      expect((await workbook(await exportOrders({ queue: 'review', mode: 'selected', orderIds: ['a'] }).expect(200))).getCell('A2').value).toBe('A')
      for (const body of [
        { orderIds: ['a', 'b'] }, { orderIds: ['shared'] }, { orderIds: ['missing'] }, { orderIds: ['a'], search: 'no-match' }, { orderIds: ['a'], departmentId: 'other' },
      ]) await exportOrders({ queue: 'review', mode: 'selected', ...body }).expect(409)
      await exportOrders({ queue: 'review', mode: 'filtered', search: 'no-match' }).expect(409)
    })
    it.each([
      { queue: 'review', mode: 'selected' }, { queue: 'review', mode: 'selected', orderIds: [] },
      { queue: 'review', mode: 'selected', orderIds: ['a', 'a'] }, { queue: 'review', mode: 'selected', orderIds: Array.from({ length: 101 }, (_, i) => String(i)) },
      { queue: 'review', mode: 'filtered', orderIds: ['a'] }, { queue: 'review', mode: 'filtered', page: 2 },
      { queue: 'review', mode: 'filtered', userId: 'bob' }, { queue: 'review', mode: 'filtered', workbenchRole: 'warehouse' },
      { queue: 'review', mode: 'filtered', warehouseStage: 'all' }, { queue: 'review', mode: 'filtered', sortBy: 'outboundStatus' },
    ])('rejects malformed or identity-injecting export %j', async body => { await exportOrders(body).expect(400) })
    it('requires workbench access and rechecks FOP grants and session before releasing a file', async () => {
      await exportOrders({ queue: 'shipping', mode: 'filtered' }).expect(403)
      let calls = 0
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ++calls === 1 ? ['a'] : [] })
      await exportOrders({ queue: 'review', mode: 'filtered' }).expect(403)
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a'] })
      provider.listOrders = async () => { accounts.get(alice).sessionVersion = 1; return structuredClone(records) }
      await exportOrders({ queue: 'review', mode: 'filtered' }).expect(401)
    })
    it('restricts manager exports to department descendants even with broader upstream authorization', async () => {
      Object.assign(accounts.get(alice), { businessRole: 'department_manager', businessDepartmentId: 'd1' })
      records = [order('member', { owner: { id: 'member', name: 'Member' }, department: { id: 'd1', name: '业务一部' }, departmentPathIds: ['d1'] }),
        order('child', { owner: { id: 'child', name: 'Child' }, department: { id: 'child-dept', name: '子部门' }, departmentPathIds: ['d1', 'child-dept'] }),
        order('private', { department: { id: 'd2', name: '业务二部' }, departmentPathIds: ['d2'] })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const sheet = await workbook(await exportOrders({ queue: 'review', mode: 'filtered' }).expect(200))
      expect(sheet.getCell('A4').value).toBe('合计 · 2 笔订单')
      expect(JSON.stringify(sheet.getSheetValues())).not.toContain('PRIVATE')
      await exportOrders({ queue: 'review', mode: 'selected', orderIds: ['private'] }).expect(409)
    })
    it.each(['filtered', 'selected'])('applies the salesperson filter to %s exports and rejects mismatched selections', async mode => {
      records = [order('a'), order('b', { owner: { id: 'other-owner', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a', 'b'] })
      const result = await exportOrders({ queue: 'review', mode, ownerId: 'alice-owner', ...(mode === 'selected' ? { orderIds: ['a'] } : {}) }, bob).expect(200)
      const sheet = await workbook(result)
      expect(sheet.getCell('A3').value).toBe('合计 · 1 笔订单')
      expect(JSON.stringify(sheet.getSheetValues())).not.toContain('Other')
      await exportOrders({ queue: 'review', mode: 'selected', ownerId: 'alice-owner', orderIds: ['b'] }, bob).expect(409)
      await exportOrders({ queue: 'review', mode: 'filtered', ownerId: ['alice-owner'] }, bob).expect(400)
    })
    it('rechecks the salesperson filter before releasing an administrator export', async () => {
      records = [order('a')]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a'] })
      let reads = 0
      provider.listOrders = async () => {
        if (++reads === 2) records[0].owner = { id: 'other-owner', name: 'Other' }
        return structuredClone(records)
      }
      await exportOrders({ queue: 'review', mode: 'filtered', ownerId: 'alice-owner' }, bob).expect(409)
    })
    it.each(['filtered', 'selected'])('applies the salesperson name search to %s exports', async mode => {
      records = [order('a'), order('b', { owner: { id: 'other-owner', name: 'Other' } })]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a', 'b'] })
      const sheet = await workbook(await exportOrders({ queue: 'review', mode, search: 'aLiCe', ...(mode === 'selected' ? { orderIds: ['a'] } : {}) }, bob).expect(200))
      expect(sheet.getCell('A3').value).toBe('合计 · 1 笔订单')
      expect(JSON.stringify(sheet.getSheetValues())).not.toContain('Other')
      await exportOrders({ queue: 'review', mode: 'selected', search: 'alice', orderIds: ['b'] }, bob).expect(409)
    })
    it.each(['owner', 'queue'])('withholds the generated workbook when %s changes during export', async change => {
      let reads = 0
      provider.listOrders = async () => {
        if (++reads === 2) {
          if (change === 'owner') records[0].owner = { id: 'another-owner', name: 'Another' }
          else records[0].reviewStatus = 'approved'
        }
        return structuredClone(records)
      }
      await exportOrders({ queue: 'review', mode: 'selected', orderIds: ['a'] }).expect(change === 'owner' ? 403 : 409)
    })
    it.each(['unpaid', 'review', 'exceptions', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'dispatch', 'shipping'])('exports the %s queue with the same inclusion rules as its list', async queue => {
      const p = { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'ready', allocationReview: 'pending', outbound: 'pending' }
      records = [order('a', { reviewStatus: queue === 'review' ? 'pending' : 'approved', paymentStatus: queue === 'unpaid' ? 'unpaid' : 'paid',
        procurementProgress: { purchaseOrder: 'ordered', supplierPayment: queue === 'procurement_shipping' ? 'paid' : 'unpaid' },
        fulfillmentProgress: { ...p, stockReadiness: queue === 'allocation' ? 'incomplete' : 'ready', allocationReview: queue === 'shipping' ? 'approved' : 'pending' }, exception: { reason: 'stock', hours: 1 } })]
      accounts.get(alice).businessRole = 'admin'
      const page = await list(`queue=${queue}`).expect(200)
      expect(page.body.total).toBe(1)
      const sheet = await workbook(await exportOrders({ queue, mode: 'filtered' }).expect(200))
      expect(sheet.getCell('A2').value).toBe('A')
    })
    it('applies warehouse stage and document-status sorting in exports', async () => {
      accounts.get(alice).businessRole = 'admin'
      records = ['pending', 'approved'].map((review, i) => order(`s${i}`, { reviewStatus: 'approved', fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'ready', allocationReview: review, outbound: 'pending' } }))
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
      const sheet = await workbook(await exportOrders({ queue: 'shipping', mode: 'filtered', warehouseStage: 'pending_outbound', sortBy: 'allocationDocumentStatus', sortOrder: 'desc' }).expect(200))
      expect(sheet.getCell('A2').value).toBe('S1')
      expect(sheet.getCell('A3').value).toBe('合计 · 1 笔订单')
    })
  })

  describe('approval HTTP boundary', () => {
    const endpoint = '/api/autoflow/integrations/fop/fulfillment-orders/approvals'
    const post = (path: string, body: unknown, id = alice) => request(app.getHttpServer()).post(endpoint + path).auth(token(id), { type: 'bearer' }).send(body as any)
    beforeEach(() => {
      provider.approvalTargets = jest.fn(async (identity: any, queue: string, orderId: string) => [{ tenantId: identity.tenantId, orderId, id: orderId, number: 'ORDER-A', entity: 'hzkj_orders', version: '1', status: 'B', eligible: true, reason: null }])
      provider.approveDocument = jest.fn(async () => ({ status: 'approved', message: '审核成功', warning: null }))
    })
    function grant() { provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a', 'b'], approvalActions: ['review', 'allocation_review'] }) }
    it('does not infer write grants from order read access or administrator status', async () => {
      expect((await post('/preview', { queue: 'review', orderIds: ['a'] })).status).toBe(403)
      expect((await post('/preview', { queue: 'review', orderIds: ['b'] }, bob)).status).toBe(403)
      expect(provider.approvalTargets).not.toHaveBeenCalled()
    })
    it('requires an authenticated account and rejects client identity or target-entity injection', async () => {
      expect((await request(app.getHttpServer()).post(endpoint + '/preview').send({ queue: 'review', orderIds: ['a'] })).status).toBe(401)
      grant()
      for (const injected of [{ subject: { userId: 'admin' } }, { entity: 'anything' }, { documentIds: ['other'] }]) expect((await post('/preview', { queue: 'review', orderIds: ['a'], ...injected })).status).toBe(400)
    })
    it('enforces employee scope even when FOP grant includes another owner order', async () => {
      grant(); records.find(row => row.id === 'b').owner.id = 'bob-owner'; expect((await post('/preview', { queue: 'review', orderIds: ['b'] })).status).toBe(404)
      expect(provider.approvalTargets).not.toHaveBeenCalled()
    })
    it('rejects unsupported queues, duplicate IDs and oversized batches', async () => {
      grant()
      for (const body of [{ queue: 'shipping', orderIds: ['a'] }, { queue: 'review', orderIds: ['a','a'] }, { queue: 'review', orderIds: [] }, { queue: 'review', orderIds: Array.from({ length: 101 }, (_, i) => String(i)) }]) expect((await post('/preview', body)).status).toBe(400)
      expect((await post('', { queue: 'review', requestId: '12345678-1234-4234-8234-123456789abc', items: Array.from({ length: 101 }, (_, i) => ({ orderId: String(i), version: 'a'.repeat(64) })) })).status).toBe(400)
    })
    it('previews and approves a full 100-order page without truncating the selection', async () => {
      records = Array.from({ length: 100 }, (_, i) => order(`page-${i}`))
      const orderIds = records.map(row => row.id)
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: orderIds, approvalActions: ['review'] })
      const preview = await post('/preview', { queue: 'review', orderIds })
      expect(preview.status).toBe(201)
      expect(preview.body.items).toHaveLength(100)
      const result = await post('', { queue: 'review', requestId: '12345678-1234-4234-8234-123456789abc', items: preview.body.items.map((row: any) => ({ orderId: row.orderId, version: row.version })) })
      expect(result.status).toBe(201)
      expect(result.body.items).toHaveLength(100)
      expect(result.body.items.every((row: any) => row.status === 'approved')).toBe(true)
      expect(provider.approveDocument).toHaveBeenCalledTimes(100)
    })
    it('submits only previewed, authorized records using server-derived FOP identity', async () => {
      grant()
      const preview = await post('/preview', { queue: 'review', orderIds: ['a'] })
      expect(preview.status).toBe(201)
      const result = await post('', { queue: 'review', requestId: '12345678-1234-4234-8234-123456789abc', items: [{ orderId: 'a', version: preview.body.items[0].version }] })
      expect(result.status).toBe(201)
      expect(result.body.items[0].status).toBe('approved')
      expect(provider.approveDocument.mock.calls[0][0]).toEqual({ tenantId: 'tenant-1', userId: 'alice-fop' })
    })
    it('stops all later writes after account disable or session revocation mid-batch', async () => {
      for (const revoke of [{ accountDisabled: true }, { sessionVersion: 1 }]) {
        Object.assign(accounts.get(alice), { accountDisabled: false, sessionVersion: 0 })
        grant()
        const preview = await post('/preview', { queue: 'review', orderIds: ['a','b'] })
        provider.approveDocument.mockReset().mockImplementation(async () => { Object.assign(accounts.get(alice), revoke); return { status: 'approved', message: '已审核', warning: null } })
        const result = await post('', { queue: 'review', requestId: '12345678-1234-4234-8234-123456789abc', items: preview.body.items.map((row: any) => ({ orderId: row.orderId, version: row.version })) })
        expect(result.body.items.map((row: any) => row.status)).toEqual(['approved','blocked'])
        expect(provider.approveDocument).toHaveBeenCalledTimes(1)
      }
    })
    it('rechecks revoked action grants when submitting a previously valid preview', async () => {
      grant(); const preview = await post('/preview', { queue: 'review', orderIds: ['a'] })
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a'] })
      const result = await post('', { queue: 'review', requestId: '12345678-1234-4234-8234-123456789abc', items: [{ orderId: 'a', version: preview.body.items[0].version }] })
      expect(result.body.items[0].status).toBe('blocked'); expect(provider.approveDocument).not.toHaveBeenCalled()
    })
  })


  describe('per-chart effective permissions', () => {
    const override = (chartId: string, values = {}) => ({ chartId, visibility: 'inherit', dataScope: 'inherit', summaryMode: 'inherit', summaryDepartments: [], details: 'inherit', export: 'inherit', ...values })
    const volume = '/autoflow/integrations/fop/order-volume?category=customer&grain=month&year=2020&warehouse=ALL'
    const chartAccess = () => get('/autoflow/integrations/fop/chart-access')
    it('returns sanitized effective capabilities, requires authentication and rejects identity injection', async () => {
      await request(app.getHttpServer()).get('/api/autoflow/integrations/fop/chart-access').expect(401)
      const result = await chartAccess().expect(200)
      expect(result.headers['cache-control']).toBe('private, no-store')
      expect(result.body.charts).toHaveLength(7)
      expect(result.body.charts.find((c: any) => c.chartId === 'customer_orders')).toMatchObject({ visible: true, dataScope: 'self' })
      for (const secret of ['allowedOrderIds', 'alice-fop', 'alice-owner']) expect(JSON.stringify(result.body.charts)).not.toContain(secret)
      for (const injected of ['userId=bob-fop', 'tenantId=tenant-2', 'chartId=customer_orders', 'dataScope=all']) await get('/autoflow/integrations/fop/chart-access?' + injected).expect(400)
    })
    it.each([
      ['customer_orders', volume],
      ['order_volume', volume.replace('category=customer', 'category=organization')],
      ['freight', '/autoflow/integrations/fop/freight?grain=month&year=2020&warehouse=ALL'],
      ['sales_performance', '/autoflow/integrations/fop/sales-performance?from=2020-01-01&to=2020-01-31&grain=month'],
      ['salesperson_receipts', '/autoflow/integrations/fop/receipts?from=2020-01-01&to=2020-01-31&workbenchRole=sales'],
    ])('denies %s at its direct endpoint despite upstream allowlists', async (chartId, path) => {
      accounts.get(alice).chartPermissions = [override(chartId, { visibility: 'deny' })]
      await get(path).expect(403)
      expect((await chartAccess().expect(200)).body.charts.find((c: any) => c.chartId === chartId)).toMatchObject({ visible: false, canViewDetails: false, canExport: false })
    })
    it('keeps rejected registration and receipt money out of dashboard payloads', async () => {
      accounts.get(alice).chartPermissions = ['registrations', 'department_receipts', 'salesperson_receipts'].map(chartId => override(chartId, { visibility: 'deny' }))
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [], allowedReceiptIds: ['r'], analyticsScopes: ['receipts', 'registrations'], organizationSummaries: [{ chartId: 'department_receipts', departments: [{ code: 'sales1', departmentId: 'd1' }] }] })
      provider.getAnalytics = async (subject: any) => ({ subject, rates: [], registrations: [{ date: '2020-01-01', count: 999999 }], registrationEntries: [] })
      receiptRecords = [receipt('r', { amount: 999999 })]
      const body = (await dashboard().expect(200)).body
      expect(body.registrations).toEqual([]); expect(body.registrationDepartments).toEqual([])
      expect(body.receipts.months).toEqual([]); expect(body.departmentReceipts.months).toEqual([])
      expect(JSON.stringify(body)).not.toContain('999999')
    })
    it('ranks two sales accounts separately before Top10, other, search and paged details', async () => {
      accounts.get(bob).businessRole = 'salesperson'; accounts.get(bob).businessEmployeeId = 'bob-owner'; accounts.get(bob).workbenchRoles = ['sales']
      records = ['alice-owner', 'bob-owner'].flatMap(ownerId => Array.from({ length: 12 }, (_, i) => order(`${ownerId}-${i}`, {
        reviewStatus: 'approved', customerId: `${ownerId}-customer-${i}`, customerCode: `${ownerId}-${i}`, customerName: `${ownerId} customer ${i}`, owner: { id: ownerId, name: ownerId }, department: { id: 'd1', name: '业务一部' }, departmentPathIds: ['d1'], salesDepartmentCode: 'sales1', currentCustomerOwner: { id: ownerId, departmentId: 'd1', departmentPathIds: ['d1'] },
      })))
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(r => r.id) })
      for (const [accountId, ownerId, forbiddenOwner] of [[alice, 'alice-owner', 'bob-owner'], [bob, 'bob-owner', 'alice-owner']]) {
        const result = (await get(volume, accountId).expect(200)).body
        expect(result.total).toBe(12); expect(result.customerCount).toBe(12)
        expect(result.series.filter((r: any) => r.kind === 'detail')).toHaveLength(10)
        expect(result.series.find((r: any) => r.id === 'other').total).toBe(2)
        expect(result.series.filter((r: any) => r.kind === 'detail').every((r: any) => r.entityId.startsWith(ownerId))).toBe(true)
        expect((await get('/autoflow/integrations/fop/order-volume/customers?keyword=' + forbiddenOwner, accountId).expect(200)).body.total).toBe(0)
        const details = (await get(volume.replace('/order-volume?', '/order-volume/orders?') + '&workbenchRole=sales&seriesId=other', accountId).expect(200)).body
        expect(details.total).toBe(2); expect(details.items.every((r: any) => r.owner.id === ownerId)).toBe(true)
      }
      accounts.get(alice).businessRole = 'department_manager'; accounts.get(alice).businessDepartmentId = 'd1'
      expect((await get(volume).expect(200)).body.total).toBe(24)
      accounts.get(alice).chartPermissions = [override('customer_orders', { dataScope: 'self' })]
      expect((await get(volume).expect(200)).body.total).toBe(12)
    })
    it('permits only independently granted organization aggregates and blocks summary detail origin spoofing', async () => {
      accounts.get(alice).chartPermissions = ['registrations', 'department_receipts', 'order_volume'].map(chartId => override(chartId, { visibility: 'allow', summaryMode: 'selected', summaryDepartments: ['sales2'] }))
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [], organizationSummaries: ['registrations', 'department_receipts', 'order_volume'].map(chartId => ({ chartId, departments: [{ code: 'sales1', departmentId: 'd1' }, { code: 'sales2', departmentId: 'd2' }] })) })
      provider.listOrders = async () => { throw new Error('No order enumeration') }; provider.listReceipts = async () => { throw new Error('No receipt enumeration') }
      provider.getOrganizationSummary = async (subject: any, _grant: any, query: any) => ({ subject, chartId: query.chartId, rows: ['sales1', 'sales2'].map(salesDepartmentCode => ({ date: '2020-01-10', salesDepartmentCode, count: 24, ...(query.chartId === 'department_receipts' ? { amount: 192, currency: 'USD', sourceType: 'fulfillment' } : {}), ...(query.chartId === 'order_volume' ? { warehouseCode: 'HZ' } : {}), owner: { id: 'PRIVATE', name: 'PRIVATE' }, customerId: 'PRIVATE' })) })
      const result = (await dashboard().expect(200)).body
      expect(result.departmentReceipts.departments).toMatchObject([{ id: 'sales2', salespeople: [] }])
      expect(result.registrationDepartments).toMatchObject([{ id: 'sales2', salespeople: [] }])
      expect(result.chartAccess.find((c: any) => c.chartId === 'registrations')).toMatchObject({ summaryOnly: true, dataScope: 'none' })
      expect(JSON.stringify(result)).not.toContain('PRIVATE')
      const organization = volume.replace('category=customer', 'category=organization') + '&view=summary'
      expect((await get(organization).expect(200)).body).toMatchObject({ total: 24, summaryOnly: true, customerCount: null, options: { objects: [] }, chartAccess: { canViewDetails: false } })
      await get(organization.replace('/order-volume?', '/order-volume/orders?') + '&workbenchRole=sales').expect(403)
      await get('/autoflow/integrations/fop/receipts?from=2020-01-01&to=2020-01-31&workbenchRole=sales&chartId=department_receipts').expect(403)
      await get(volume + '&view=summary').expect(400)
    })
    it('discards a response if a chart override is changed while upstream data is loading', async () => {
      provider.listOrders = async () => { accounts.get(alice).chartPermissions = [override('customer_orders', { visibility: 'deny' })]; return records }
      expect((await get(volume).expect(403)).body.code).toBe('fop_binding_changed')
    })
  })

  describe('sales performance endpoints', () => {
    const root = '/autoflow/integrations/fop/sales-performance'
    const filters = '?from=2020-01-01&to=2020-01-31&grain=month'
    const paths = () => [root + filters, root + '/details' + filters + '&kind=profit']
    beforeEach(() => {
      const base: FopProfitCandidate = {
        tenantId: 'tenant-1', id: 'p1', orderId: 'o1', orderNumber: 'SO1', customerCode: 'C1', customerName: 'Customer', owner: { id: 'alice-owner', name: 'Alice' }, department: { id: 'd1', name: 'Sales' }, departmentPathIds: ['d1'], salesDepartmentCode: 'sales1',
        recognitionMonth: '2020-01', recognitionDate: null, knownAt: '2020-02-02T08:00:00+08:00', status: 'settled', settlementId: 'settlement1', version: 's1', approvedAt: '2020-02-02T08:00:00+08:00', cutoffAt: '2020-02-01T00:00:00+08:00', freightBasis: 'frozen',
        incomeAmount: 100, adjustmentIncome: 0, productCost: 30, freightCost: 10, refundCost: 0, returnCost: 0, otherCost: 0, previousRecognizedProfit: 0, roundingAdjustment: 0, amount: 60, currency: 'USD', originalAmount: 60, originalCurrency: 'USD', fxRateToUsd: 1, fxRateDate: '2020-01-31', fxRateSource: 'fixture',
      }
      profitRecords = [{ ...base, secret: 'private' } as FopProfitCandidate, { ...base, id: 'bob-profit', orderId: 'ob', owner: { id: 'bob-owner', name: 'Bob' } }, { ...base, id: 'foreign', tenantId: 'private' }]
      receiptRecords = [receipt('receipt1')]
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [], allowedReceiptIds: ['receipt1'], allowedProfitIds: ['p1', 'bob-profit', 'foreign'], analyticsScopes: ['receipts', 'sales_profit'] })
      provider.listOrders = async () => { throw new Error('Must not enumerate orders') }
    })
    it('requires authentication, strict query fields and private cache controls on both routes', async () => {
      for (const path of paths()) {
        await request(app.getHttpServer()).get('/api' + path).expect(401)
        for (const injected of ['userId=bob-fop', 'tenantId=tenant-2', 'allowedProfitIds=bob-profit', 'businessRole=admin', 'asOf=2099-01-01']) await get(path + '&' + injected).expect(400)
        expect((await get(path).expect(200)).headers['cache-control']).toBe('private, no-store')
      }
    })
    it('selects the bound employee, enforces owner scope, and reconciles paged details without private provider data', async () => {
      const summary = (await get(root + filters).expect(200)).body
      expect(summary).toMatchObject({ selectedOwner: { id: 'alice-owner' }, canSelectOwner: false, totals: { collectionsAmount: 8, settledGrossProfit: 60 } })
      const detail = (await get(root + '/details' + filters + '&kind=profit&pageSize=1').expect(200)).body
      expect(detail.total).toBe(1); expect(detail.totals).toEqual(summary.totals)
      for (const field of ['tenantId', 'departmentPathIds', 'secret']) expect(detail.profits[0]).not.toHaveProperty(field)
      for (const path of paths()) await get(path + '&ownerId=bob-owner').expect(403)
      const manager = (await get(root + filters + '&ownerId=bob-owner', bob).expect(200)).body
      expect(manager).toMatchObject({ canSelectOwner: true, selectedOwner: { id: 'bob-owner' }, totals: { collectionsAmount: 0, settledGrossProfit: 60 } })
    })
    it('preserves undated month references in day details and rejects invalid filters', async () => {
      const result = (await get(root + '/details' + filters.replace('grain=month', 'grain=day') + '&kind=profit&periodId=2020-01-10').expect(200)).body
      expect(result).toMatchObject({ total: 1, totals: { settledGrossProfit: null, unallocatedCount: 1 }, unallocatedSettlements: [{ month: '2020-01', amount: 60, count: 1 }] })
      for (const suffix of ['&page=0', '&pageSize=101', '&periodId=2021-01', '&ownerId=', '&kind=unknown']) await get(root + '/details' + filters + '&kind=profit' + suffix).expect(400)
      for (const dates of ['from=2020-02-30&to=2020-03-01', 'from=2019-01-01&to=2019-01-02', 'from=2020-01-01&to=2021-01-02']) await get(root + '?' + dates + '&grain=day').expect(400)
    })
    it('requires separate cost and receipt grants and sales access even for system administrators', async () => {
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['o1'], allowedReceiptIds: ['receipt1'], allowedProfitIds: ['p1'], analyticsScopes: ['receipts'] })
      for (const path of paths()) await get(path, bob).expect(403)
      accounts.get(bob).businessRole = 'none'
      for (const path of paths()) await get(path, bob).expect(403)
    })
    it('rejects duplicate upstream versions and identity changes without disclosing diagnostics', async () => {
      profitRecords.push({ ...profitRecords[0], id: 'p2', version: 's2' })
      provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [], allowedReceiptIds: ['receipt1'], allowedProfitIds: ['p1', 'p2'], analyticsScopes: ['receipts', 'sales_profit'] })
      expect((await get(root + filters).expect(503)).body.code).toBe('fop_unavailable')
      provider.listProfits = async () => { accounts.get(alice).businessEmployeeId = 'bob-owner'; return [] }
      expect((await get(root + filters).expect(403)).body.code).toBe('fop_binding_changed')
    })
  })

  describe('freight analysis endpoints', () => {
    const root = '/autoflow/integrations/fop/freight'
    const filters = '?grain=month&year=2020&warehouse=ALL'
    const freight = (id: string, extra: Partial<FopFreightCandidate> = {}): FopFreightCandidate => ({
      tenantId: 'tenant-1', id, documentNumber: `DL-${id}`, orderNumber: 'SO-1', trackingNumber: 'YT001', carrierCode: 'YT', carrierName: '云途', channelName: '标准专线',
      warehouseCode: 'HZ', warehouse: '杭州仓', customerId: 'c1', customerCode: 'C001', customerName: 'Customer', owner: { id: 'alice-owner', name: 'Alice' }, department: { id: 'd1', name: '业务一部' },
      originalAmount: 70, originalCurrency: 'CNY', fxRateToUsd: 1 / 7, fxRateDate: '2020-01-01', fxRateSource: 'fixture', amount: 10, currency: 'USD',
      confirmedAt: '2020-01-10T00:00:00Z', reviewStatus: 'approved', costStatus: 'confirmed', ...extra,
    })
    beforeEach(() => {
      freightRecords = [freight('a'), freight('b', { owner: { id: 'bob-owner', name: 'Bob' } }), freight('foreign', { tenantId: 'other-tenant' }), freight('outside')]
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedFreightIds: ['a', 'b', 'foreign'], analyticsScopes: ['freight'] })
    })
    it('requires authentication and forbids client identity/cost scope injection for both endpoints', async () => {
      for (const path of [root + filters, root + '/details' + filters + '&workbenchRole=sales']) {
        await request(app.getHttpServer()).get('/api' + path).expect(401)
        for (const injection of ['userId=bob-fop', 'allowedFreightIds=b', 'businessRole=admin']) await get(path + '&' + injection).expect(400)
      }
    })
    it('isolates every total and detail amount and does not serialize private fields', async () => {
      const summary = await get(root + filters).expect(200)
      expect(summary.headers['cache-control']).toBe('private, no-store')
      expect(summary.body.totals.amount).toBe(10)
      expect(summary.body.billCount).toBe(1)
      const detail = await get(root + '/details' + filters + '&periodId=2020-01&workbenchRole=sales&pageSize=1').expect(200)
      expect(detail.body.total).toBe(1)
      expect(detail.body.items[0].id).toBe('a')
      expect(detail.body.items[0]).not.toHaveProperty('tenantId')
      expect(detail.body.items[0]).not.toHaveProperty('departmentPathIds')
      expect(detail.body.totals.amount).toBe(summary.body.totals.amount)
      expect((await get(root + filters, bob).expect(200)).body.totals.amount).toBe(20)
      expect((await get(root + filters + '&carrierCode=4PX').expect(200)).body.billCount).toBe(0)
      await get(root + '/details' + filters + '&workbenchRole=dispatch').expect(403)
    })
    it('does not grant freight from order/receipt scope or system management privileges', async () => {
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['a'], allowedReceiptIds: ['a'], analyticsScopes: ['receipts'] })
      await get(root + filters, bob).expect(403)
      await get(root + '/details' + filters + '&workbenchRole=sales', bob).expect(403)
      accounts.get(bob).businessRole = 'none'
      await get(root + filters, bob).expect(403)
    })
    it('rejects invalid period and paging filters without broadening the query', async () => {
      for (const query of ['grain=day&year=2020', 'grain=month', 'grain=month&year=9999', 'grain=month&year=2020&weekOf=2020-01-01', 'grain=week&year=2020&weekOf=2020-02-30', 'grain=month&year=2020&carrierCode=UNASSIGNED']) await get(root + '?' + query).expect(400)
      for (const suffix of ['&page=0', '&pageSize=101', '&periodId=2021-01', '&comparisonPeriod=all']) await get(root + '/details' + filters + '&workbenchRole=sales' + suffix).expect(400)
    })
    it('returns safe unavailable errors for corrupt FX and duplicate cost snapshots', async () => {
      freightRecords[0].fxRateSource = 'private-upstream-secret'
      freightRecords[0].fxRateToUsd = 0
      const response = await get(root + filters).expect(503)
      expect(JSON.stringify(response.body)).not.toContain('private-upstream-secret')
      freightRecords = [freight('a'), freight('a')]
      await get(root + filters).expect(503)
    })
  })

  describe('order volume endpoints', () => {
    const root = '/autoflow/integrations/fop/order-volume'
    const filters = '?category=customer&grain=month&year=2020&warehouse=ALL'
    beforeEach(() => {
      records = records.map(o => ({ ...o, reviewStatus: 'approved', customerId: o.id, customerCode: `C-${o.id}`, salesDepartmentCode: 'sales1', warehouseCode: 'HZ', carrierCode: 'YT' }))
      receiptRecords = [receipt('ra', { customerId: 'a', customerCode: 'C-a', amount: 4 }), receipt('rb', { customerId: 'b', customerCode: 'C-b', amount: 999 }), receipt('shared', { customerId: 'shared', customerCode: 'C-shared', amount: 6 })]
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: identity.userId === 'alice-fop' ? ['a', 'shared'] : ['b', 'shared'], allowedReceiptIds: identity.userId === 'alice-fop' ? ['ra', 'shared'] : ['rb', 'shared'], analyticsScopes: ['receipts'] })
    })
    it('authenticates all endpoints and rejects identity injection', async () => {
      for (const path of [root + filters, root + '/customers?keyword=C', root + '/orders' + filters + '&workbenchRole=sales']) {
        await request(app.getHttpServer()).get('/api' + path).expect(401)
        await get(path + '&userId=bob-fop').expect(400)
      }
    })
    it('supports customer date ranges without a year or timeline and retains authorization in drilldown', async () => {
      const range = '?category=customer&from=2020-01-10&to=2020-01-10&warehouse=ALL'
      const response = await get(root + range).expect(200)
      expect(response.body.total).toBe(2)
      expect(response.body.periods).toEqual([{ id: '2020-01-10', label: '2020-01-10', from: '2020-01-10', to: '2020-01-10', future: false }])
      expect(response.body.query).not.toHaveProperty('year')
      expect((await get(root + '/orders' + range + '&workbenchRole=allocation&pageSize=1').expect(200)).body.totals.orderCount).toBe(2)
      expect((await get(root + range + '&customerId=outside').expect(200)).body.total).toBe(0)
      expect((await get(root + '?category=customer&from=2020-01-11&to=2020-01-12&warehouse=ALL').expect(200)).body.total).toBe(0)
      for (const suffix of ['&year=2020', '&grain=day', '&userId=other']) await get(root + range + suffix).expect(400)
      for (const bad of ['from=2020-01-10', 'from=2020-02-30&to=2020-03-01', 'from=2020-01-11&to=2020-01-10', 'from=2020-01-01&to=9999-12-31']) {
        await get(root + '?category=customer&warehouse=ALL&' + bad).expect(400)
      }
      await get(root + '/orders' + range + '&workbenchRole=warehouse').expect(403)
    })
    it('scopes rankings, customer names, totals and details before aggregation or paging', async () => {
      const a = await get(root + filters).expect(200)
      expect(a.headers['cache-control']).toBe('private, no-store')
      expect(a.body.total).toBe(2)
      expect(a.body.series[0].amounts).toMatchObject({ currency: 'USD', total: 10, excludedOrderCount: 0 })
      expect(a.body.series[0].amounts.values[0]).toBe(10)
      expect(a.body.series[0].amounts.warehouses.HZ[0]).toBe(10)
      expect(a.body.series[0].amounts.warehouses.SZ[0]).toBe(0)
      expect(a.body.series.filter((s: any) => s.kind === 'detail').map((s: any) => s.entityId).sort()).toEqual(['a', 'shared'])
      const customers = await get(root + '/customers?keyword=C-&pageSize=1').expect(200)
      expect(customers.body.total).toBe(2)
      expect(customers.body.items).toHaveLength(1)
      expect((await get(root + filters + '&customerId=b').expect(200)).body.total).toBe(0)
      expect((await get(root + filters + '&customerId=b').expect(200)).body.series[0].amounts.total).toBe(0)
      expect((await get(root + '/customers?keyword=C-b').expect(200)).body.total).toBe(0)
      const detail = await get(root + '/orders' + filters + '&workbenchRole=allocation&seriesId=customer:a&periodId=2020-01').expect(200)
      expect(detail.body.items.map((o: any) => o.id)).toEqual(['a'])
      expect(detail.body.totals).toEqual({ orderCount: 1, itemQuantity: 1, amountsByCurrency: [{ currency: 'USD', amount: 10 }] })
      const allDetails = await get(root + '/orders' + filters + '&workbenchRole=allocation&pageSize=1').expect(200)
      expect(allDetails.body.items).toHaveLength(1)
      expect(allDetails.body.totals).toEqual({ orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 20 }] })
      await get(root + '/orders' + filters + '&workbenchRole=warehouse').expect(403)
      await get(root + '/customers?keyword=%20').expect(400)
    })
    it('applies department scope and fails closed when binding changes during a request', async () => {
      accounts.get(alice).businessRole = 'department_manager'
      accounts.get(alice).businessDepartmentId = 'd1'
      records = records.map(o => ({ ...o, department: { id: o.id === 'a' ? 'd1' : 'd2', name: 'Department' } }))
      expect((await get(root + filters).expect(200)).body.total).toBe(1)
      provider.listOrders = async () => { accounts.get(alice).fopUserId = 'revoked'; return records }
      await get(root + filters).expect(403)
    })
  })

  describe('receipt analytics endpoints', () => {
    const root = '/autoflow/integrations/fop'
    const receiptFilters = '?from=2020-01-01&to=2020-01-31&warehouse=ALL&workbenchRole=sales'
    const cohortFilters = '?category=customer&grain=month&year=2020&warehouse=ALL&workbenchRole=sales'
    const receipts = (extra = '', actor = alice) => get(root + '/receipts' + receiptFilters + extra, actor)
    const cohort = (extra = '', actor = alice) => get(root + '/order-volume/receipts' + cohortFilters + extra, actor)
    beforeEach(() => {
      receiptRecords = [receipt('r-a'), receipt('r-stock', { sourceType: 'full_payment_stock', documentId: 'stock-1', documentNumber: 'STOCK-1', carrierCode: null, amount: 80, orderAmount: 80, handlingFee: 0, warehouseCode: 'SZ', warehouse: '深圳仓' })]
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: ['r-a', 'r-stock'], analyticsScopes: ['receipts'] })
    })
    it('authenticates both routes, rejects injected identity and scope, and requires the selected workbench role', async () => {
      for (const path of [root + '/receipts' + receiptFilters, root + '/order-volume/receipts' + cohortFilters]) {
        await request(app.getHttpServer()).get('/api' + path).expect(401)
        for (const forged of ['userId=bob-fop', 'tenantId=other', 'allowedReceiptIds=outside', 'allowedOrderIds=outside', 'analyticsScopes=receipts']) await get(path + '&' + forged).expect(400)
        await get(path.replace('workbenchRole=sales', 'workbenchRole=warehouse')).expect(403)
      }
      await get(root + '/receipts?from=2020-01-01&to=2020-01-31').expect(400)
      await get(root + '/order-volume/receipts' + cohortFilters.replace('category=customer', 'category=carrier')).expect(400)
    })
    it('requires independent receipt IDs and the receipts analytics scope even when orders are visible', async () => {
      const load = jest.spyOn(provider, 'listReceipts')
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['a', 'shared'], allowedReceiptIds: ['r-a'] })
      await receipts().expect(403)
      await cohort().expect(403)
      expect(load).not.toHaveBeenCalled()
      const noAmount = await get(root + '/order-volume?category=customer&grain=month&year=2020').expect(200)
      expect(noAmount.body.series[0]).not.toHaveProperty('amounts')
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['a', 'shared'], analyticsScopes: ['receipts'] })
      expect((await receipts().expect(200)).body).toMatchObject({ total: 0, totals: { receiptCount: 0, amount: 0 }, items: [] })
      expect((await cohort().expect(200)).body.total).toBe(0)
      expect(load).not.toHaveBeenCalled()
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: ['r-stock'], analyticsScopes: ['receipts'] })
      expect((await receipts().expect(200)).body.items.map((row: any) => row.id)).toEqual(['r-stock'])
      expect((await cohort().expect(200)).body.items.map((row: any) => row.id)).toEqual(['r-stock'])
    })
    it('includes only paid, source-approved, receipt-approved fulfillment and full-payment stocking lines', async () => {
      receiptRecords.push(
        receipt('deposit', { sourceType: 'deposit_stock', carrierCode: null, amount: 999 }),
        receipt('unpaid', { paymentStatus: 'unpaid', paidAt: null }), receipt('refunded', { paymentStatus: 'refunded' }),
        receipt('source-pending', { reviewStatus: 'pending' }), receipt('receipt-pending', { receiptReviewStatus: 'pending' }),
        receipt('cancelled', { cancelled: true }), receipt('future', { paidAt: '9999-01-01T00:00:00Z' }),
        receipt('eur', { currency: 'EUR', amount: 999 }),
      )
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: receiptRecords.map(row => row.id), analyticsScopes: ['receipts'] })
      for (const response of [await receipts().expect(200), await cohort().expect(200)]) {
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(response.body.items.map((row: any) => row.id)).toEqual(['r-a', 'r-stock'])
        expect(response.body.totals).toEqual({ receiptCount: 2, currency: 'USD', amount: 88, fulfillmentAmount: 8, fullPaymentStockAmount: 80, orderAmount: 90, handlingFee: 2 })
        expect(response.body.items[0]).toMatchObject({ documentId: 'order-r-a', amount: 8, orderAmount: 10, handlingFee: 2, reviewStatus: 'approved', receiptReviewStatus: 'approved' })
        expect(response.body.items[1].carrierCode).toBeNull()
        for (const item of response.body.items) {
          expect(item).not.toHaveProperty('tenantId')
          expect(item).not.toHaveProperty('departmentPathIds')
        }
      }
    })
    it('rejects duplicate authorized receipt IDs on both receipt endpoints', async () => {
      receiptRecords.push({ ...receiptRecords[0] })
      await receipts().expect(503)
      await cohort().expect(503)
    })
    it('isolates tenants and employees before totals, customer discovery and pagination', async () => {
      receiptRecords = [
        receipt('own'), receipt('bob', { owner: { id: 'bob-owner', name: 'Bob' }, amount: 1000 }),
        receipt('outside', { amount: 9999 }), receipt('own', { tenantId: 'tenant-2', customerName: 'OTHER TENANT SECRET', amount: 99999 }),
      ]
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: identity.userId === 'alice-fop' ? ['own', 'bob'] : ['bob'], analyticsScopes: ['receipts'] })
      for (const response of [await receipts('&pageSize=1').expect(200), await cohort('&pageSize=1').expect(200)]) {
        expect(response.body).toMatchObject({ total: 1, totals: { amount: 8 } })
        expect(response.body.items.map((row: any) => row.id)).toEqual(['own'])
        expect(JSON.stringify(response.body)).not.toContain('OTHER TENANT SECRET')
      }
      expect((await receipts('', bob).expect(200)).body.items.map((row: any) => row.id)).toEqual(['bob'])
      expect((await get(root + '/order-volume/customers?keyword=C-bob').expect(200)).body.total).toBe(0)
      expect((await get(root + '/order-volume/customers?keyword=C-own').expect(200)).body.items[0].id).toBe('own')
      accounts.get(alice).businessRole = 'department_manager'
      accounts.get(alice).businessDepartmentId = 'd2'
      expect((await receipts().expect(200)).body.total).toBe(0)
    })
    it.each(['binding', 'workbench', 'employee'] as const)('rejects %s revocation while receipt rows are loading', async change => {
      provider.listReceipts = async () => {
        if (change === 'binding') accounts.get(alice).fopUserId = 'revoked'
        if (change === 'workbench') accounts.get(alice).workbenchRoles = []
        if (change === 'employee') accounts.get(alice).businessEmployeeId = 'other-owner'
        return receiptRecords
      }
      await receipts().expect(403)
    })
    it('rereads receipt grants on the next request and discards a revoked cohort read', async () => {
      expect((await receipts().expect(200)).body.total).toBe(2)
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: [], analyticsScopes: ['receipts'] })
      expect((await receipts().expect(200)).body.total).toBe(0)
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [], allowedReceiptIds: ['r-a'], analyticsScopes: ['receipts'] })
      provider.listReceipts = async () => { accounts.get(alice).fopTenantId = 'revoked'; return receiptRecords }
      await cohort().expect(403)
    })
    it('keeps totals independent of pagination and applies receipt dimensions and Shanghai payment dates', async () => {
      receiptRecords[0].paidAt = '2019-12-31T16:00:00Z'
      const first = await receipts('&pageSize=1').expect(200)
      const second = await receipts('&pageSize=1&page=2').expect(200)
      expect(first.body.total).toBe(2)
      expect(first.body.items[0].id).toBe('r-stock')
      expect(second.body.items[0].id).toBe('r-a')
      expect(second.body.totals).toEqual(first.body.totals)
      expect(first.body.totals.amount).toBe(88)
      expect((await cohort('&detailWarehouse=SZ').expect(200)).body.totals.amount).toBe(80)
      expect((await cohort('&periodId=2020-02').expect(200)).body.total).toBe(0)
      expect((await get(root + '/receipts' + receiptFilters.replace('warehouse=ALL', 'warehouse=SZ') + '&sourceType=full_payment_stock&department=sales1&ownerId=alice-owner').expect(200)).body.totals.amount).toBe(80)
      expect((await receipts('&customerId=unknown').expect(200)).body.total).toBe(0)
      expect((await receipts('&ownerId=other-owner').expect(200)).body.total).toBe(0)
      await receipts('&sourceType=deposit_stock').expect(400)
      for (const range of ['from=2020-02-30&to=2020-03-01', 'from=2020-02-01&to=2020-01-01', 'from=2020-01-01&to=9999-01-01']) await get(root + '/receipts?' + range + '&workbenchRole=sales').expect(400)
    })
    it('drills into the same Top 10 and Other customer receipt cohort without adding stock receipts to order counts', async () => {
      records = Array.from({ length: 12 }, (_, index) => order(`c${index}`, { reviewStatus: 'approved', customerId: `c${index}`, customerCode: `C-c${index}`, salesDepartmentCode: 'sales1' }))
      receiptRecords = records.map((row, index) => receipt(`r${index}`, { customerId: row.customerId, amount: index + 1 }))
      receiptRecords.push(receipt('stock-only', { sourceType: 'full_payment_stock', carrierCode: null, customerId: 'stock-only', amount: 80 }))
      provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: records.map(row => row.id), allowedReceiptIds: receiptRecords.map(row => row.id), analyticsScopes: ['receipts'] })
      const chart = await get(root + '/order-volume?category=customer&grain=month&year=2020&warehouse=ALL').expect(200)
      expect(chart.body.total).toBe(12)
      expect(chart.body.customerCount).toBe(13)
      expect(chart.body.series[0].amounts.total).toBe(158)
      const other = chart.body.series.find((row: any) => row.id === 'other')
      const details = await cohort('&seriesId=other&periodId=2020-01&pageSize=1').expect(200)
      expect(details.body.total).toBe(3)
      expect(details.body.items).toHaveLength(1)
      expect(details.body.totals.amount).toBe(other.amounts.total)
      const second = await cohort('&seriesId=other&periodId=2020-01&pageSize=1&page=2').expect(200)
      expect(second.body.totals).toEqual(details.body.totals)
      expect((await cohort('&customerId=stock-only').expect(200)).body.totals.amount).toBe(80)
      expect((await get(root + '/order-volume/orders' + cohortFilters + '&customerId=stock-only').expect(200)).body.total).toBe(0)
      expect((await cohort('&seriesId=customer:unknown').expect(200)).body.total).toBe(0)
      await cohort('&periodId=2021-01').expect(400)
    })
    it('fails closed on malformed authorized receipts without disclosing provider diagnostics', async () => {
      receiptRecords[0].amount = NaN
      for (const response of [await receipts().expect(503), await cohort().expect(503)]) expect(JSON.stringify(response.body)).not.toContain('Invalid receipt amount')
      provider.listReceipts = async () => { throw new Error('secret receipt provider diagnostic') }
      expect(JSON.stringify((await receipts().expect(503)).body)).not.toContain('secret receipt provider diagnostic')
    })
  })

  it('requires authentication on every FOP data route', async () => {
    for (const path of ['data-access', 'fulfillment-orders?queue=review', 'dashboard?from=2020-01-01&to=2020-01-31&year=2020']) {
      await request(app.getHttpServer()).get(`/api/autoflow/integrations/fop/${path}`).expect(401)
    }
  })

  it('prevents browser and proxy caching of authenticated scope and account responses', async () => {
    for (const response of [
      await access().expect(200), await list().expect(200), await dashboard().expect(200),
      await get('/users/workbench-accounts', bob).expect(200),
      await get('/workbench/access').expect(200), await get('/workbench/sales/access').expect(200),
      await bind({ tenantId: 'tenant-1', userId: 'alice-fop' }).expect(200),
    ]) expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('uses database-admin-only bindings, trims IDs and allows explicit unbinding', async () => {
    await bind({ tenantId: 'tenant-2', userId: 'alice-fop' }, alice).expect(403)
    const response = await bind({ tenantId: ' tenant-2 ', userId: ' new-user ' }).expect(200)
    expect(response.body.fopBinding).toEqual({ tenantId: 'tenant-2', userId: 'new-user' })
    expect(response.body).not.toHaveProperty('password')
    expect(accounts.get(alice).role).toBe('user')
    expect(accounts.get(alice).workbenchRoles).toEqual(['sales', 'allocation'])
    const catalog = await get('/users/workbench-accounts', bob).expect(200)
    expect(catalog.body.items.find((item: any) => item.id === alice).fopBinding).toEqual({ tenantId: 'tenant-2', userId: 'new-user' })
    await bind({ tenantId: null, userId: null }).expect(200)
    expect((await access().expect(200)).body).toEqual({ binding: null, status: 'unbound' })
    expect((await list().expect(403)).body.code).toBe('fop_binding_required')
    accounts.get(bob).role = UserRole.USER
    await bind({ tenantId: 'tenant-1', userId: 'alice-fop' }).expect(403)
  })

  it.each([{}, { tenantId: 'tenant-1' }, { tenantId: null, userId: 'x' }, { tenantId: 'x', userId: null }, { tenantId: '', userId: '' }, { tenantId: '   ', userId: 'x' }, { tenantId: 'x'.repeat(129), userId: 'x' }, { tenantId: 'x', userId: 'y', role: 'admin' }])('rejects invalid binding %j', async (body) => {
    await bind(body).expect(400)
    expect(accounts.get(alice).fopUserId).toBe('alice-fop')
  })

  it('rejects assigning an FOP identity already bound to another employee', async () => {
    await bind({ tenantId: 'tenant-1', userId: 'bob-fop' }).expect(409)
    expect(accounts.get(alice).fopUserId).toBe('alice-fop')
  })

  it('rejects client-forged identity and order scope on all data routes', async () => {
    for (const query of ['userId=bob-fop', 'tenantId=tenant-2', 'allowedOrderIds=outside', 'ownerUserId=' + bob]) {
      await list(`queue=review&${query}`).expect(400)
      await dashboard(alice, `&${query}`).expect(400)
      await get(`/autoflow/integrations/fop/data-access?${query}`).expect(400)
    }
    await request(app.getHttpServer()).put('/api/users/profile').auth(token(alice), { type: 'bearer' })
      .send({ fopUserId: 'bob-fop', fopTenantId: 'tenant-1' }).expect(400)
  })

  it('returns authorized monetary and item totals for the full filtered list, independent of pagination', async () => {
    records = [order('a', { amount: 0.1, items: [{ sku: 'one', name: 'One', imageUrl: null, variant: '', quantity: 2 }, { sku: 'two', name: 'Two', imageUrl: null, variant: '', quantity: 3 }] }), order('shared', { amount: 0.2 }), order('outside', { amount: 99999 })]
    const first = await list('queue=review&pageSize=1').expect(200)
    const second = await list('queue=review&pageSize=1&page=2').expect(200)
    expect(first.body.items).toHaveLength(1)
    expect(first.body.totals).toEqual({ orderCount: 2, itemQuantity: 6, amountsByCurrency: [{ currency: 'USD', amount: 0.3 }] })
    expect(second.body.totals).toEqual(first.body.totals)
    expect((await list('queue=review&orderNumber=A').expect(200)).body.totals).toEqual({ orderCount: 1, itemQuantity: 5, amountsByCurrency: [{ currency: 'USD', amount: 0.1 }] })
    records[1].currency = 'EUR'
    expect((await list('queue=review').expect(200)).body.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 0.1 }, { currency: 'EUR', amount: 0.2 }])
    expect((await list('queue=review&search=missing').expect(200)).body.totals).toEqual({ orderCount: 0, itemQuantity: 0, amountsByCurrency: [] })
  })

  it('isolates records before search, pagination and totals while honoring explicit sharing', async () => {
    const a = await list('queue=review&pageSize=1').expect(200)
    const b = await list('queue=review', bob).expect(200)
    expect(a.body).toMatchObject({ source: 'fop', total: 1, page: 1, pageSize: 1 })
    expect(a.body.items.map((item: any) => item.id)).toEqual(['a'])
    expect(a.body.items[0]).not.toHaveProperty('tenantId')
    expect(b.body.items.map((item: any) => item.id)).toEqual(['b'])
    for (const user of [alice, bob]) {
      expect((await list('queue=allocation', user).expect(200)).body.items.map((item: any) => item.id)).toEqual(['shared'])
      expect((await list('queue=review&search=outside', user).expect(200)).body.total).toBe(0)
      expect((await list('queue=review&orderNumber=OUTSIDE', user).expect(200)).body.total).toBe(0)
    }
    expect((await list('queue=review&page=2').expect(200)).body.items).toEqual([])
  })

  it('aggregates only allowed records and business queues, with no fabricated auxiliary data', async () => {
    const a = await dashboard().expect(200)
    const b = await dashboard(bob).expect(200)
    expect(a.body).toMatchObject({ source: 'fop', queues: { review: 1, allocation: 1, dispatch: 0, shipping: 0 }, rates: [], registrations: [], receipts: { currency: 'USD', months: [], departments: [] } })
    expect(a.body.exceptions.map((item: any) => item.id)).toEqual(['A'])
    expect(b.body.queues.review).toBe(1)
    expect(b.body.exceptions).toEqual([])
    const recentRange = await get('/autoflow/integrations/fop/dashboard?from=2021-01-01&to=2021-01-07&year=2021').expect(200)
    expect(recentRange.body.queues).toEqual(a.body.queues)
    expect(recentRange.body.exceptions).toEqual(a.body.exceptions)
    accounts.get(alice).workbenchRoles = ['allocation']
    const restricted = await dashboard().expect(200)
    expect(restricted.body.queues).toEqual({ review: 0, allocation: 1, dispatch: 0, procurement: 0, shipping: 0 })
    expect(restricted.body.exceptions).toEqual([])
    expect(restricted.body.tasks.map((task: any) => task.kind)).toEqual(['allocation'])
  })

  it.each(['review', 'dispatch', 'procurement', 'allocation', 'shipping'])('isolates %s counts, tasks, search and totals by the logged-in employee and FOP grant', async queue => {
    const progress = {
      allocationCreated: true,
      shopifySync: 'pending', supplierShipment: 'partial',
      stockReadiness: queue === 'shipping' ? 'ready' : 'incomplete',
      allocationReview: queue === 'shipping' ? 'approved' : 'pending', outbound: 'pending',
    }
    const candidate = (id: string, employeeId: string, departmentId: string, ancestors: string[], amount: number, quantity: number) => order(id, {
      owner: { id: employeeId, name: employeeId }, department: { id: departmentId, name: departmentId }, departmentPathIds: ancestors,
      amount, items: [{ sku: id, name: id, imageUrl: null, variant: '', quantity }],
      reviewStatus: queue === 'review' ? 'pending' : 'approved', fulfillmentProgress: progress,
    })
    records = [
      candidate('self', 'alice-owner', 'd1', ['d1'], 10, 2),
      candidate('peer', 'peer-owner', 'd1-child', ['d1', 'd1-child'], 20, 3),
      candidate('outside-department', 'other-owner', 'd2', ['d2'], 30, 4),
      candidate('not-granted', 'alice-owner', 'd1', ['d1'], 1000, 100),
    ]
    records.push({ ...records[0], id: 'foreign-tenant', tenantId: 'tenant-2' }, { ...records[0] })
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['self', 'peer', 'outside-department', 'foreign-tenant'] })
    // Even system administration and all five job roles cannot enlarge employee data scope.
    accounts.get(alice).role = UserRole.ADMIN
    accounts.get(alice).workbenchRoles = ['sales', 'dispatch', 'procurement', 'allocation', 'warehouse']
    accounts.get(alice).businessDepartmentId = 'd1'
    const cases = [
      { role: 'salesperson', ids: ['self'], count: 1, amount: 10, quantity: 2, outside: 0 },
      { role: 'department_manager', ids: ['peer', 'self'], count: 2, amount: 30, quantity: 5, outside: 0 },
      { role: 'admin', ids: ['outside-department', 'peer', 'self'], count: 3, amount: 60, quantity: 9, outside: 1 },
    ]
    for (const example of cases) {
      accounts.get(alice).businessRole = example.role
      const page = (await list(`queue=${queue}&pageSize=100`).expect(200)).body
      const summary = (await dashboard().expect(200)).body
      expect(page.items.map((row: any) => row.id).sort()).toEqual(example.ids)
      expect(page.total).toBe(example.count)
      expect(page.totals).toEqual({ orderCount: example.count, itemQuantity: example.quantity, amountsByCurrency: [{ currency: 'USD', amount: example.amount }] })
      expect(summary.queues[queue]).toBe(example.count)
      expect(summary.tasks.find((task: any) => task.kind === queue)?.count).toBe(example.count)
      const paged = (await list(`queue=${queue}&pageSize=1`).expect(200)).body
      expect(paged.items).toHaveLength(1)
      expect(paged.totals).toEqual(page.totals)
      const searched = (await list(`queue=${queue}&search=outside-department`).expect(200)).body
      const exact = (await list(`queue=${queue}&orderNumber=OUTSIDE-DEPARTMENT`).expect(200)).body
      expect(searched.total).toBe(example.outside)
      expect(exact.total).toBe(example.outside)
      expect((await list(`queue=${queue}&search=not-granted`).expect(200)).body.total).toBe(0)
      await list(`queue=${queue}&userId=bob-fop`).expect(400)
    }
    accounts.get(alice).businessRole = 'none'
    await list(`queue=${queue}`).expect(403)
    await dashboard().expect(403)
  })

  it('returns empty data for an empty allowlist, including for administrators', async () => {
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [] })
    provider.listOrders = () => { throw new Error('Must not enumerate without allowed IDs') }
    expect((await access(bob).expect(200)).body.status).toBe('ready')
    for (const queue of ['review', 'dispatch', 'procurement', 'allocation', 'shipping']) {
      const page = (await list(`queue=${queue}`, bob).expect(200)).body
      expect(page.total).toBe(0)
      expect(page.totals).toEqual({ orderCount: 0, itemQuantity: 0, amountsByCurrency: [] })
    }
    const summary = (await dashboard(bob).expect(200)).body
    expect(summary.queues).toEqual({ review: 0, dispatch: 0, procurement: 0, allocation: 0, shipping: 0 })
    expect(summary.tasks).toEqual([])
  })

  it.each(['salesperson', 'department_manager', 'admin'])('keeps every dashboard card equal to its exact todo union for %s', async businessRole => {
    Object.assign(accounts.get(alice), { businessRole, businessDepartmentId: 'd1', workbenchRoles: ['sales', 'dispatch', 'procurement', 'allocation', 'warehouse'] })
    const completed = { allocationCreated: true, shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'approved', outbound: 'completed' }
    const row = (id: string, progress = {}, extra = {}) => order(id, { department: { id: 'd1', name: 'Department 1' }, departmentPathIds: ['d1'], reviewStatus: 'approved',
      procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid' }, fulfillmentProgress: { ...completed, ...progress }, ...extra })
    const cases = [
      row('review-and-sync', { allocationCreated: false, shopifySync: 'pending' }, { reviewStatus: 'pending' }),
      row('approved-sync-pending', { shopifySync: 'pending' }),
      row('tracking-awaiting-sync', { allocationCreated: true, shopifySync: 'pending' }, { trackingNumber: 'TRACK-AWAITING-SYNC' }),
      row('purchase-unpaid', {}, { procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid' } }),
      row('purchase-paid-pending', { supplierShipment: 'pending' }),
      row('incomplete', { stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' }),
      row('ready', { allocationReview: 'pending', outbound: 'pending' }),
      row('outbound-pending', { outbound: 'pending' }),
      row('incomplete-approved', { stockReadiness: 'incomplete', outbound: 'pending' }),
      row('not-created', { allocationCreated: false, stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' }),
      row('not-created-ready', { allocationCreated: false, allocationReview: 'pending', outbound: 'pending' }),
      row('unknown-created', { allocationCreated: null, stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' }),
      row('unknown-purchase', { supplierShipment: 'pending' }, { procurementProgress: { purchaseOrder: 'unknown', supplierPayment: 'unknown' } }),
      row('unpaid', { allocationCreated: true, shopifySync: 'pending' }, { paymentStatus: 'unpaid', reviewStatus: 'pending' }),
      row('cancelled', { allocationReview: 'pending', outbound: 'pending', shopifySync: 'pending' }, { cancelled: true }),
    ]
    records = cases.flatMap(source => [source,
      { ...source, id: `${source.id}-member`, owner: { id: 'member', name: 'Member' } },
      { ...source, id: `${source.id}-outside`, owner: { id: 'outside', name: 'Outside' }, department: { id: 'd2', name: 'Department 2' }, departmentPathIds: ['d2'] }])
    const allowedIds = records.map(r => r.id)
    records.push({ ...cases[0], id: 'not-granted' }, { ...cases[0], id: 'foreign', tenantId: 'other-tenant' }, { ...cases[0] })
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [...allowedIds, 'foreign'] })
    const factor = businessRole === 'salesperson' ? 1 : businessRole === 'department_manager' ? 2 : 3
    const result = (await dashboard().expect(200)).body
    expect(result.queues).toEqual({ review: factor, dispatch: 2 * factor, procurement: 2 * factor, allocation: 2 * factor, shipping: factor })
    for (const [card, queues] of Object.entries({ review: ['review'], dispatch: ['dispatch'], procurement: ['procurement', 'procurement_shipping'], allocation: ['allocation', 'allocation_review'], shipping: ['shipping'] })) {
      let total = 0
      for (const queue of queues) {
        const page = (await list(`queue=${queue}&pageSize=1`).expect(200)).body
        total += page.total
        expect(page.totals.orderCount).toBe(page.total)
      }
      expect(result.queues[card]).toBe(total)
      expect(result.tasks.find((task: any) => task.kind === card).count).toBe(total)
    }
    const warehouseReview = (await list('queue=shipping&warehouseStage=pending_review').expect(200)).body.total
    const warehouseApproved = (await list('queue=shipping&warehouseStage=pending_outbound').expect(200)).body.total
    expect(warehouseReview).toBe(0)
    expect(warehouseApproved).toBe(factor)
  })

  it('keeps logistics-blocked purchase preparation visible and preserves normalized 1688 facts', async () => {
    accounts.get(alice).workbenchRoles = ['procurement']
    const procurementProgress = { purchaseApplication: 'created', purchaseOrder: 'ordered', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate: 'pending_logistics' }
    records = [order('preparing', { reviewStatus: 'approved', procurementProgress, dispatchDocuments: [], trackingNumber: null })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['preparing'] })
    const page = (await list('queue=procurement').expect(200)).body
    expect(page.total).toBe(1)
    expect(page.items[0].procurementProgress).toEqual(procurementProgress)
    records[0].procurementProgress = { purchaseOrder: 'ordered', supplierPayment: 'unpaid' }
    expect((await list('queue=procurement').expect(200)).body.items[0].procurementProgress).toMatchObject({ purchaseApplication: 'unknown', alibabaOrder: 'unknown', logisticsGate: 'unknown' })
    records[0].procurementProgress.logisticsGate = 'ready-to-buy'
    await list('queue=procurement').expect(503)
  })

  it.each(['not_required', 'paid', 'unknown'])('keeps unfinished 1688 preparation visible and exclusive when payment is %s', async supplierPayment => {
    accounts.get(alice).workbenchRoles = ['procurement']
    records = [order('prep', { reviewStatus: 'approved', procurementProgress: { purchaseOrder: 'ordered', supplierPayment, alibabaOrder: 'partial', logisticsGate: 'pending_logistics' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['prep'] })
    expect((await list('queue=procurement').expect(200)).body.total).toBe(1)
    expect((await list('queue=procurement_shipping').expect(200)).body.total).toBe(0)
    expect((await dashboard().expect(200)).body.queues.procurement).toBe(1)
  })

  it('does not infer allocation creation from order approval or progress and validates its fact', async () => {
    accounts.get(alice).workbenchRoles = ['sales', 'allocation', 'warehouse']
    records = [order('missing', { reviewStatus: 'approved', fulfillmentProgress: { shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'ready', allocationReview: 'pending', outbound: 'pending' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['missing'] })
    for (const queue of ['allocation', 'allocation_review', 'shipping']) expect((await list(`queue=${queue}`).expect(200)).body.total).toBe(0)
    records[0].reviewStatus = 'pending'
    expect((await list('queue=review').expect(200)).body.items[0].fulfillmentProgress.allocationCreated).toBeNull()
    records[0].fulfillmentProgress.allocationCreated = 'yes'
    await list('queue=review').expect(503)
  })

  it('prioritizes oldest payment before paging, with stable ties and missing dates last', async () => {
    records = [order('missing', { paidAt: null }), order('invalid', { paidAt: 'bad-date' }),
      order('older', { createdAt: '2020-01-20T00:00:00Z', paidAt: '2020-01-01T09:00:00+08:00' }),
      order('new-b', { createdAt: '2019-01-01T00:00:00Z' }), order('new-a')]
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: records.map(r => r.id) })
    const first = await list('queue=review&pageSize=1&page=1').expect(200)
    expect(first.body.items.map((item: any) => item.id)).toEqual(['older'])
    records.reverse()
    const second = await list('queue=review&pageSize=1&page=2').expect(200)
    expect(second.body.items.map((item: any) => item.id)).toEqual(['new-a'])
    expect(second.body.total).toBe(5)
    expect((await list().expect(200)).body.items.map((item: any) => item.id)).toEqual(['older', 'new-a', 'new-b', 'invalid', 'missing'])
    expect((await list().expect(200)).body.items.find((item: any) => item.id === 'invalid').paidAt).toBeNull()
    const descending = (await list('queue=review&paidAtOrder=desc').expect(200)).body
    expect(descending.items.map((item: any) => item.id)).toEqual(['new-a', 'new-b', 'older', 'invalid', 'missing'])
    expect(descending.totals).toEqual(first.body.totals)
    expect((await list('queue=review&paidAtOrder=desc&pageSize=1&page=2').expect(200)).body.items.map((item: any) => item.id)).toEqual(['new-b'])
    await list('queue=review&paidAtOrder=invalid').expect(400)
    await list('queue=review&paidAtOrder=asc&paidAtOrder=desc').expect(400)
  })
  it('reads current queue progress on refresh and returns a no-store query completion timestamp', async () => {
    const first = await list().expect(200)
    expect(first.headers['cache-control']).toBe('private, no-store')
    expect(Number.isFinite(Date.parse(first.body.refreshedAt))).toBe(true)
    records = records.map(row => row.id === 'a' ? { ...row, reviewStatus: 'approved' } : row)
    const next = await list().expect(200)
    expect(next.body.items).toEqual([])
    expect(next.body.total).toBe(0)
    expect(next.body.totals.orderCount).toBe(0)
    expect(Date.parse(next.body.refreshedAt)).toBeGreaterThanOrEqual(Date.parse(first.body.refreshedAt))
  })

  it.each(['review', 'procurement', 'allocation', 'dispatch', 'shipping', 'exceptions'])('filters %s by department before totals and pagination for company collaborators without management rights', async queue => {
    accounts.get(bob).role = UserRole.USER
    const pending = { reviewStatus: queue === 'review' ? 'pending' : 'approved', exception: { reason: 'stock', hours: 1 },
      ...(queue === 'shipping' ? { fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'approved', outbound: 'pending' } } : {}) }
    records = [order('b', { ...pending, department: { id: 'd2', name: '业务二部' }, salesDepartmentCode: 'sales2', amount: 999 }),
      order('a2', { ...pending, department: { id: 'd1', name: '业务一部' }, salesDepartmentCode: 'sales1', amount: 20 }),
      order('a1', { ...pending, department: { id: 'd1', name: '业务一部' }, salesDepartmentCode: 'sales1', amount: 10, paidAt: '2020-01-01T00:00:00Z' }),
      order('secret', { ...pending, department: { id: 'secret-dept', name: 'SECRET' } })]
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['a1', 'a2', 'b'] })
    const all = (await list(`queue=${queue}`, bob).expect(200)).body
    expect(all.total).toBe(3)
    expect(all.departments).toEqual([{ id: 'd1', name: '业务一部' }, { id: 'd2', name: '业务二部' }])
    const filtered = (await list(`queue=${queue}&departmentId=d1&pageSize=1&page=1`, bob).expect(200)).body
    expect(filtered.items.map((r: any) => r.id)).toEqual(['a1'])
    expect(filtered.total).toBe(2)
    expect(filtered.totals).toEqual({ orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 30 }] })
    expect(filtered.departments).toEqual(all.departments)
    const searched = (await list(`queue=${queue}&departmentId=d1&search=absent`, bob).expect(200)).body
    expect(searched.total).toBe(0)
    expect(searched.departments).toEqual(all.departments)
    expect((await list(`queue=${queue}&departmentId=secret-dept`, bob).expect(200)).body.total).toBe(0)
    expect((await list(`queue=${queue}&departmentId=unknown`, bob).expect(200)).body.total).toBe(0)
  })

  it.each(['review', 'exceptions', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'dispatch', 'shipping'])('filters %s by warehouse and carrier before totals and pagination', async queue => {
    accounts.get(alice).workbenchRoles = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse']
    const pending = { reviewStatus: queue === 'review' ? 'pending' : 'approved', paymentStatus: queue === 'unpaid' ? 'unpaid' : 'paid',
      procurementProgress: { purchaseOrder: 'ordered', supplierPayment: queue === 'procurement_shipping' ? 'paid' : 'unpaid' },
      fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: queue === 'allocation' ? 'incomplete' : 'ready', allocationReview: queue === 'shipping' ? 'approved' : 'pending', outbound: 'pending' }, exception: { reason: 'stock', hours: 1 } }
    records = [order('hz-a', { ...pending, warehouseCode: 'HZ', amount: 10 }), order('hz-b', { ...pending, warehouseCode: 'HZ', amount: 20 }), order('sz', { ...pending, warehouseCode: 'SZ', warehouse: '深圳仓' }), order('other-carrier', { ...pending, carrier: '4PX', carrierCode: '4PX' }), order('secret', { ...pending, owner: { id: 'secret-owner', name: 'Secret' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const result = (await list(`queue=${queue}&warehouseCode=HZ&search=yT&pageSize=1`).expect(200)).body
    expect(result.items.map((row: any) => row.id)).toEqual(['hz-a'])
    expect(result.total).toBe(2)
    expect(result.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 30 }])
    expect((await list(`queue=${queue}&warehouseCode=SZ&search=${encodeURIComponent('云途')}`).expect(200)).body.items.map((row: any) => row.id)).toEqual(['sz'])
    await list(`queue=${queue}&warehouseCode=INVALID`).expect(400)
    await list(`queue=${queue}&warehouseCode=HZ&warehouseCode=SZ`).expect(400)
  })

  it.each(['unpaid', 'review', 'exceptions', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'dispatch', 'shipping'])('filters %s by salesperson before totals and pagination with scoped department options', async queue => {
    const pending = { reviewStatus: queue === 'review' ? 'pending' : 'approved', paymentStatus: queue === 'unpaid' ? 'unpaid' : 'paid',
      procurementProgress: { purchaseOrder: 'ordered', supplierPayment: queue === 'procurement_shipping' ? 'paid' : 'unpaid' },
      fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: queue === 'allocation' ? 'incomplete' : 'ready', allocationReview: queue === 'shipping' ? 'approved' : 'pending', outbound: 'pending' },
      exception: { reason: 'stock', hours: 1 }, department: { id: 'd1', name: 'Department 1' } }
    records = [order('a1', { ...pending, amount: 10, paidAt: '2020-01-01T00:00:00Z' }), order('a2', { ...pending, amount: 20 }),
      order('b', { ...pending, owner: { id: 'bob-owner', name: 'Alice' }, amount: 999 }),
      order('outside', { ...pending, owner: { id: 'outside-owner', name: 'Outside' }, department: { id: 'd2', name: 'Department 2' } }),
      order('secret', { ...pending, owner: { id: 'secret-owner', name: 'Secret' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: ['a1', 'a2', 'b', 'outside'] })
    const result = (await list(`queue=${queue}&ownerId=alice-owner&departmentId=d1&pageSize=1`, bob).expect(200)).body
    expect(result.items.map((row: any) => row.id)).toEqual(['a1'])
    expect(result.total).toBe(2)
    expect(result.totals).toEqual({ orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 30 }] })
    expect(result.salespeople).toEqual([{ id: 'alice-owner', name: 'Alice' }, { id: 'bob-owner', name: 'Alice' }])
    // Names occur only on owner, not customer/order/SKU: free-text search must
    // include the displayed salesperson and remain within department scope.
    const byName = (await list(`queue=${queue}&departmentId=d1&search=%20ALicE%20&pageSize=1`, bob).expect(200)).body
    expect(byName.items.map((row: any) => row.id)).toEqual(['a1'])
    expect(byName.total).toBe(3)
    expect(byName.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 1029 }])
    const precise = (await list(`queue=${queue}&departmentId=d1&search=alice&ownerId=bob-owner`, bob).expect(200)).body
    expect(precise.items.map((row: any) => row.id)).toEqual(['b'])
    expect((await list(`queue=${queue}&search=secret`, bob).expect(200)).body.total).toBe(0)
    const empty = (await list(`queue=${queue}&ownerId=outside-owner&departmentId=d1&search=absent`, bob).expect(200)).body
    expect(empty.total).toBe(0)
    expect(empty.salespeople).toEqual(result.salespeople)
    expect((await list(`queue=${queue}&ownerId=secret-owner`, bob).expect(200)).body.total).toBe(0)
  })

  it('searches Chinese salesperson names within self and manager scope using the displayed name', async () => {
    records = [order('mine', { owner: { id: 'alice-owner', name: '陈晨（Alice）' }, department: { id: 'd1', name: 'Department 1' }, departmentPathIds: ['d1'], salesperson: 'Old Name' }),
      order('member', { owner: { id: 'member-owner', name: '陈晨（Bob）' }, department: { id: 'd1', name: 'Department 1' }, departmentPathIds: ['d1'] }),
      order('outside', { owner: { id: 'outside-owner', name: '陈晨（Carol）' }, department: { id: 'd2', name: 'Department 2' }, departmentPathIds: ['d2'] }),
      order('foreign', { tenantId: 'tenant-2', owner: { id: 'foreign-owner', name: '陈晨（Foreign）' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const query = `queue=review&search=${encodeURIComponent('陈晨')}`
    expect((await list(query).expect(200)).body.items.map((row: any) => row.id)).toEqual(['mine'])
    Object.assign(accounts.get(alice), { businessRole: 'department_manager', businessDepartmentId: 'd1' })
    expect((await list(query).expect(200)).body.items.map((row: any) => row.id)).toEqual(['member', 'mine'])
    expect((await list('queue=review&search=Old%20Name').expect(200)).body.total).toBe(0)
  })

  it('limits salesperson options and filters to employee / manager scope and validates IDs', async () => {
    records = [order('a', { department: { id: 'd1', name: 'Department 1' }, departmentPathIds: ['d1'] }),
      order('member', { owner: { id: 'member', name: 'Member' }, department: { id: 'team', name: 'Team' }, departmentPathIds: ['d1', 'team'] }),
      order('outside', { owner: { id: 'outside', name: 'Outside' }, department: { id: 'd2', name: 'Department 2' }, departmentPathIds: ['d2'] }),
      order('foreign', { tenantId: 'tenant-2', owner: { id: 'foreign', name: 'Foreign' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    expect((await list().expect(200)).body.salespeople).toEqual([{ id: 'alice-owner', name: 'Alice' }])
    expect((await list('queue=review&ownerId=member').expect(200)).body.total).toBe(0)
    Object.assign(accounts.get(alice), { businessRole: 'department_manager', businessDepartmentId: 'd1' })
    const manager = (await list('queue=review&departmentId=d1&ownerId=member').expect(200)).body
    expect(manager.items.map((row: any) => row.id)).toEqual(['member'])
    expect(manager.salespeople.map((row: any) => row.id)).toEqual(['alice-owner', 'member'])
    expect((await list('queue=review&ownerId=outside').expect(200)).body.total).toBe(0)
    await list(`queue=review&ownerId=${'x'.repeat(129)}`).expect(400)
    await list('queue=review&ownerId=a&ownerId=b').expect(400)
  })

  it('sorts dispatch documents across the authorized result before paging with unknowns last', async () => {
    accounts.get(alice).workbenchRoles.push('dispatch')
    const row = (id: string, states: string[] | null, extra = {}) => order(id, { reviewStatus: 'approved', department: { id: 'd1', name: '业务一部' },
      dispatchDocuments: states?.map((status, i) => ({ id: `${id}-${i}`, number: `FY-${id}-${i}`, status })) ?? null, ...extra })
    records = [row('z-none', []), row('b-draft', ['draft']), row('a-mixed', ['approved', 'draft']),
      row('c-submitted', ['submitted']), row('d-approved', ['approved']), row('y-unknown', ['approved', 'unknown']), row('x-missing', null),
      row('private', ['draft']), row('foreign', [], { owner: { id: 'bob-owner', name: 'Bob' } }),
      row('other-dept', [], { department: { id: 'd2', name: '业务二部' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(r => r.id !== 'private').map(r => r.id) })
    const query = 'queue=dispatch&departmentId=d1&sortBy=dispatchDocumentStatus'
    const asc = (await list(query + '&sortOrder=asc').expect(200)).body
    expect(asc.items.map((r: any) => r.id)).toEqual(['z-none', 'a-mixed', 'b-draft', 'c-submitted', 'd-approved', 'x-missing', 'y-unknown'])
    const desc = (await list(query + '&sortOrder=desc').expect(200)).body
    expect(desc.items.map((r: any) => r.id)).toEqual(['d-approved', 'c-submitted', 'a-mixed', 'b-draft', 'z-none', 'x-missing', 'y-unknown'])
    expect(desc.totals).toEqual(asc.totals)
    expect(asc.totals.orderCount).toBe(7)
    expect((await list(query + '&sortOrder=desc&pageSize=1&page=3').expect(200)).body.items[0].id).toBe('a-mixed')
    records.find(r => r.id === 'b-draft').paidAt = '2020-01-01T00:00:00Z'
    expect((await list(query + '&search=draft').expect(200)).body.items[0].id).toBe('b-draft')
    expect((await list(query).expect(200)).body.items.slice(1, 3).map((r: any) => r.id)).toEqual(['b-draft', 'a-mixed'])
    records.find(r => r.id === 'b-draft').dispatchDocuments[0].status = 'approved'
    expect((await list(query + '&sortOrder=desc&pageSize=1').expect(200)).body.items[0].id).toBe('b-draft')
    accounts.get(alice).workbenchRoles = ['sales']
    await list(query).expect(403)
  })

  it('sorts allocation and outbound stages by visible workflow state and retains warehouse filters', async () => {
    accounts.get(alice).workbenchRoles.push('warehouse')
    const row = (id: string, allocationReview: string, outbound: string, paidAt: string | null) => order(id, { reviewStatus: 'approved', paidAt,
      fulfillmentProgress: { ...order(id).fulfillmentProgress, stockReadiness: 'ready', allocationReview, outbound } })
    records = [row('review', 'pending', 'unknown', '2020-01-01T00:00:00Z'), row('outbound', 'approved', 'pending', '2020-01-03T00:00:00Z'),
      row('partial', 'approved', 'partial', '2020-01-02T00:00:00Z'), row('null-date', 'approved', 'pending', null)]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(r => r.id) })
    for (const [sortBy, asc, desc] of [
      ['allocationDocumentStatus', ['partial', 'outbound', 'null-date'], ['partial', 'outbound', 'null-date']],
      ['outboundStatus', ['outbound', 'null-date', 'partial'], ['partial', 'outbound', 'null-date']],
    ] as const) {
      expect((await list(`queue=shipping&sortBy=${sortBy}&sortOrder=asc`).expect(200)).body.items.map((r: any) => r.id)).toEqual(asc)
      expect((await list(`queue=shipping&sortBy=${sortBy}&sortOrder=desc`).expect(200)).body.items.map((r: any) => r.id)).toEqual(desc)
    }
    expect((await list('queue=shipping&sortBy=outboundStatus&sortOrder=desc&warehouseStage=pending_review').expect(200)).body.items.map((r: any) => r.id)).toEqual([])
    expect((await list('queue=shipping&sortBy=paidAt&sortOrder=desc').expect(200)).body.items.map((r: any) => r.id)).toEqual(['outbound', 'partial', 'null-date'])
    for (const invalid of ['queue=shipping&sortBy=dispatchDocumentStatus', 'queue=allocation&sortBy=outboundStatus', 'queue=review&sortBy=allocationDocumentStatus', 'queue=shipping&sortBy=bad', 'queue=shipping&sortOrder=bad', 'queue=shipping&sortBy=paidAt&sortBy=outboundStatus', 'queue=shipping&sortOrder=asc&sortOrder=desc']) await list(invalid).expect(400)
  })

  it('returns only authorized unpaid orders and moves a paid order into review on refresh', async () => {
    const unpaid = (id: string, amount: number, extra = {}) => order(id, { paymentStatus: 'unpaid', paidAt: null, amount, department: { id: 'd1', name: '业务一部' }, ...extra })
    records = [unpaid('a', 10), unpaid('b', 20), unpaid('cancelled', 999, { cancelled: true }),
      unpaid('refunded', 999, { paymentStatus: 'refunded' }), unpaid('paid', 999, { paymentStatus: 'paid', paidAt: '2020-01-10T00:00:00Z' }),
      unpaid('other-owner', 999, { owner: { id: 'bob-owner', name: 'Bob' } }), unpaid('private', 999),
      unpaid('other-department', 30, { department: { id: 'd2', name: '业务二部' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(r => r.id !== 'private').map(r => r.id) })
    const query = 'queue=unpaid&departmentId=d1&pageSize=1'
    const page = (await list(query).expect(200)).body
    expect(page.items.map((row: any) => row.id)).toEqual(['a'])
    expect(page.items[0].paidAt).toBeNull()
    expect(page.total).toBe(2)
    expect(page.totals).toEqual({ orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 30 }] })
    expect((await list(query + '&page=2').expect(200)).body.items[0].id).toBe('b')
    expect((await list(query + '&search=private').expect(200)).body.total).toBe(0)
    records[0].paymentStatus = 'paid'; records[0].paidAt = '2020-01-11T00:00:00Z'
    expect((await list(query).expect(200)).body.items.map((r: any) => r.id)).toEqual(['b'])
    expect((await list('queue=review&orderNumber=A').expect(200)).body.total).toBe(1)
    const summary = (await dashboard().expect(200)).body
    expect(summary.queues.review).toBe(2)
    expect(summary.queues).not.toHaveProperty('unpaid')
    accounts.get(alice).workbenchRoles = ['allocation']
    await list(query).expect(403)
  })

  it('partitions procurement and allocation queues using independent facts and keeps role/data gates', async () => {
    accounts.get(alice).workbenchRoles.push('procurement')
    const candidate = (id: string, purchaseOrder: string, supplierPayment: string, extra = {}) => order(id, {
      reviewStatus: 'approved', procurementProgress: { purchaseOrder, supplierPayment }, ...extra,
    })
    records = [candidate('unpaid', 'ordered', 'unpaid'), candidate('part-paid', 'ordered', 'partial'),
      candidate('part-ordered', 'partial', 'paid'), candidate('unknown', 'unknown', 'unknown'),
      candidate('paid', 'ordered', 'paid'), candidate('part-shipped', 'ordered', 'paid', {
        fulfillmentProgress: { ...order('base').fulfillmentProgress, supplierShipment: 'partial' }, amount: 20 }),
      candidate('shipped', 'ordered', 'paid', { fulfillmentProgress: { ...order('base').fulfillmentProgress, supplierShipment: 'shipped' } }),
      candidate('refunded', 'ordered', 'refunded'), candidate('private', 'ordered', 'paid'),
      candidate('other-owner', 'ordered', 'paid', { owner: { id: 'bob-owner', name: 'Bob' } }),
      candidate('customer-unpaid', 'ordered', 'paid', { paymentStatus: 'unpaid' }),
      candidate('cancelled', 'ordered', 'paid', { cancelled: true })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'private').map(row => row.id) })
    const pending = (await list('queue=procurement').expect(200)).body
    expect(pending.items.map((row: any) => row.id).sort()).toEqual(['part-ordered', 'part-paid', 'refunded', 'unpaid'])
    const purchased = (await list('queue=procurement_shipping&pageSize=1').expect(200)).body
    expect(purchased.total).toBe(2)
    expect(purchased.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 30 }])
    expect((await list('queue=procurement_shipping&pageSize=1&page=2').expect(200)).body.items).toHaveLength(1)
    expect((await dashboard().expect(200)).body.queues.procurement).toBe(pending.total + purchased.total)
    records.find(row => row.id === 'unpaid').procurementProgress.supplierPayment = 'paid'
    expect((await list('queue=procurement_shipping').expect(200)).body.total).toBe(3)
    accounts.get(alice).workbenchRoles = ['allocation']
    await list('queue=procurement_shipping').expect(403)
    records = [candidate('incomplete', 'ordered', 'paid'), candidate('ready', 'ordered', 'paid', {
      fulfillmentProgress: { ...order('base').fulfillmentProgress, stockReadiness: 'ready' },
      dispatchDocuments: [{ id: 'dispatch-1', number: 'FY-1', status: 'submitted' }],
    }), candidate('complete', 'ordered', 'paid', { fulfillmentProgress: { ...order('base').fulfillmentProgress, stockReadiness: 'ready', outbound: 'completed' } })]
    expect((await list('queue=allocation').expect(200)).body.items.map((row: any) => row.id)).toEqual(['incomplete'])
    const ready = (await list('queue=allocation_review').expect(200)).body
    expect(ready.items.map((row: any) => row.id)).toEqual(['ready'])
    expect(ready.items[0].dispatchDocuments[0].status).toBe('submitted')
    expect((await dashboard().expect(200)).body.queues.allocation).toBe(2)
    accounts.get(alice).workbenchRoles = ['warehouse']
    await list('queue=allocation_review').expect(403)
  })

  it('combines procurement stages for dashboard counts and task age within the current business scope', async () => {
    accounts.get(alice).workbenchRoles = ['procurement']
    accounts.get(alice).businessDepartmentId = 'd1'
    records = ['alice-owner', 'peer-owner', 'other-owner'].flatMap((ownerId, index) => ['unpaid', 'paid'].map(payment => order(`${index}-${payment}`, {
      owner: { id: ownerId, name: ownerId }, department: { id: index === 2 ? 'd2' : 'd1', name: index === 2 ? '业务二部' : '业务一部' },
      reviewStatus: 'approved', procurementProgress: { purchaseOrder: 'ordered', supplierPayment: payment },
      paidAt: payment === 'paid' ? '2020-01-01T01:15:00Z' : '2020-01-02T03:30:00Z',
    })))
    records.push(structuredClone(records[0]), { ...records[1], id: 'foreign', tenantId: 'other-tenant' },
      { ...records[1], id: 'not-granted' }, { ...records[1], id: 'shipped', fulfillmentProgress: { ...records[1].fulfillmentProgress, supplierShipment: 'shipped' } })
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'not-granted').map(row => row.id) })
    for (const [role, expected] of [['salesperson', 2], ['department_manager', 4], ['admin', 6]] as const) {
      accounts.get(alice).businessRole = role
      const summary = (await dashboard().expect(200)).body
      expect(summary.queues.procurement).toBe(expected)
      expect(summary.tasks.find((task: any) => task.kind === 'procurement')).toMatchObject({ count: expected, time: '09:15' })
      const pending = (await list('queue=procurement').expect(200)).body.total
      const purchased = (await list('queue=procurement_shipping').expect(200)).body.total
      expect(summary.queues.procurement).toBe(pending + purchased)
    }
    // Payment moves an order between tabs without reducing the combined backlog.
    accounts.get(alice).businessRole = 'salesperson'
    records.find(row => row.id === '0-unpaid').procurementProgress.supplierPayment = 'paid'
    expect((await dashboard().expect(200)).body.queues.procurement).toBe(2)
    records.find(row => row.id === '0-paid').fulfillmentProgress.supplierShipment = 'shipped'
    expect((await dashboard().expect(200)).body.queues.procurement).toBe(1)
    accounts.get(alice).workbenchRoles = ['sales']
    const restricted = (await dashboard().expect(200)).body
    expect(restricted.queues.procurement).toBe(0)
    expect(restricted.tasks.some((task: any) => task.kind === 'procurement')).toBe(false)
  })

  it('combines allocation stages within data scope and sorts review facts independently', async () => {
    accounts.get(alice).workbenchRoles = ['allocation']
    accounts.get(alice).businessDepartmentId = 'd1'
    records = ['alice-owner', 'peer-owner', 'other-owner'].flatMap((ownerId, index) => ['incomplete', 'ready'].map(stockReadiness => order(`${index}-${stockReadiness}`, {
      owner: { id: ownerId, name: ownerId }, department: { id: index === 2 ? 'd2' : 'd1', name: '部门' }, reviewStatus: 'approved',
      paidAt: stockReadiness === 'ready' ? '2020-01-01T01:15:00Z' : '2020-01-02T03:30:00Z',
      fulfillmentProgress: { ...order('base').fulfillmentProgress, stockReadiness },
    })))
    records.push(structuredClone(records[0]), { ...records[1], id: 'private' }, { ...records[1], id: 'foreign', tenantId: 'other-tenant' },
      { ...records[1], id: 'outbound', fulfillmentProgress: { ...records[1].fulfillmentProgress, outbound: 'completed' } })
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'private').map(row => row.id) })
    for (const [role, expected] of [['salesperson', 2], ['department_manager', 4], ['admin', 6]] as const) {
      accounts.get(alice).businessRole = role
      const summary = (await dashboard().expect(200)).body
      expect(summary.queues.allocation).toBe(expected)
      expect(summary.tasks.find((task: any) => task.kind === 'allocation')).toMatchObject({ count: expected, time: '09:15' })
      expect(summary.queues.allocation).toBe((await list('queue=allocation').expect(200)).body.total + (await list('queue=allocation_review').expect(200)).body.total)
    }
    accounts.get(alice).businessRole = 'salesperson'
    records[0].fulfillmentProgress.stockReadiness = 'ready'
    expect((await dashboard().expect(200)).body.queues.allocation).toBe(2)
    records[1].fulfillmentProgress.allocationReview = 'approved'
    expect((await dashboard().expect(200)).body.queues.allocation).toBe(1)
    // A reversal to incomplete stock must not overwrite the independent audit fact.
    records = ['approved', 'pending', 'unknown'].map((allocationReview, index) => order(`sort-${index}`, {
      reviewStatus: 'approved', paidAt: `2020-01-0${index + 1}T00:00:00Z`,
      fulfillmentProgress: { ...order('base').fulfillmentProgress, allocationReview },
    }))
    expect((await list('queue=allocation&sortBy=allocationReviewStatus&sortOrder=asc&pageSize=1').expect(200)).body.items[0].id).toBe('sort-1')
    expect((await list('queue=allocation&sortBy=allocationReviewStatus&sortOrder=desc').expect(200)).body.items.map((r: any) => r.id)).toEqual(['sort-1'])
    expect((await list('queue=allocation&sortBy=stockReadiness').expect(200)).body.items.map((r: any) => r.id)).toEqual(['sort-1'])
    await list('queue=review&sortBy=allocationReviewStatus').expect(400)
    accounts.get(alice).workbenchRoles = ['sales']
    const restricted = (await dashboard().expect(200)).body
    expect(restricted.queues.allocation).toBe(0)
    expect(restricted.tasks.some((task: any) => task.kind === 'allocation')).toBe(false)
  })

  it('filters warehouse stages before totals and pagination without widening scope', async () => {
    accounts.get(alice).workbenchRoles.push('warehouse')
    const row = (id: string, allocationReview: string, amount: number, extra = {}) => order(id, {
      reviewStatus: 'approved', amount, department: { id: 'd1', name: '业务一部' },
      fulfillmentProgress: { ...order(id).fulfillmentProgress, stockReadiness: 'ready', allocationReview }, ...extra,
    })
    records = [row('ready', 'pending', 10), row('approved-a', 'approved', 20), row('approved-b', 'approved', 30),
      row('private', 'pending', 999), row('other-owner', 'pending', 999, { owner: { id: 'bob-owner', name: 'Bob' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(r => r.id !== 'private').map(r => r.id) })
    const query = 'queue=shipping&departmentId=d1&warehouseStage='
    expect((await list(query + 'all').expect(200)).body.total).toBe(2)
    const pending = (await list(query + 'pending_review').expect(200)).body
    expect(pending.items.map((r: any) => r.id)).toEqual([])
    expect(pending.totals.amountsByCurrency).toEqual([])
    const approved = (await list(query + 'pending_outbound&pageSize=1').expect(200)).body
    expect(approved.total).toBe(2)
    expect(approved.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 50 }])
    expect((await list(query + 'pending_outbound&pageSize=1&page=2').expect(200)).body.items[0].id).toBe('approved-b')
    expect((await list(query + 'pending_outbound&search=ready').expect(200)).body.total).toBe(0)
    records[0].fulfillmentProgress.allocationReview = 'approved'
    expect((await list(query + 'pending_review').expect(200)).body.total).toBe(0)
    expect((await list(query + 'pending_outbound').expect(200)).body.total).toBe(3)
    for (const invalid of ['queue=shipping&warehouseStage=bad', 'queue=shipping&warehouseStage=all&warehouseStage=pending_review', 'queue=allocation&warehouseStage=all']) await list(invalid).expect(400)
  })

  it('hands approved allocation to warehouse with shared totals, authorization and refresh transitions', async () => {
    accounts.get(alice).workbenchRoles.push('warehouse')
    const warehouseOrder = (id: string, allocationReview: string, outbound: string, extra = {}) => order(id, {
      reviewStatus: 'approved', department: { id: 'd1', name: '业务一部' },
      fulfillmentProgress: { allocationCreated: true, shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview, outbound }, ...extra,
    })
    records = [warehouseOrder('ready', 'pending', 'pending'),
      warehouseOrder('approved', 'approved', 'pending', { owner: { id: 'bob-owner', name: 'Bob' }, amount: 20 }),
      warehouseOrder('partial', 'approved', 'partial', { amount: 30 }),
      warehouseOrder('complete', 'approved', 'completed'), warehouseOrder('complete-unreviewed', 'pending', 'completed'),
      warehouseOrder('unknown-review', 'unknown', 'pending'), warehouseOrder('unknown-outbound', 'approved', 'unknown'),
      warehouseOrder('unpaid', 'pending', 'pending', { paymentStatus: 'unpaid' }),
      warehouseOrder('cancelled', 'pending', 'pending', { cancelled: true }),
      warehouseOrder('not-reviewed', 'pending', 'pending', { reviewStatus: 'pending' }),
      warehouseOrder('private', 'pending', 'pending')]
    records.push({ ...records[0] })
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.filter(row => row.id !== 'private').map(row => row.id) })
    const result = (await list('queue=shipping&departmentId=d1&pageSize=1', bob).expect(200)).body
    expect(result.total).toBe(2)
    expect(result.totals).toEqual({ orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 50 }] })
    const summary = (await dashboard(bob).expect(200)).body
    expect(summary.queues.shipping).toBe(2)
    expect(summary.tasks.find((task: any) => task.kind === 'shipping').count).toBe(2)
    expect((await list('queue=shipping', alice).expect(200)).body.items.map((row: any) => row.id)).toEqual(['partial'])
    records = records.map(row => row.id === 'ready' ? { ...row, fulfillmentProgress: { ...row.fulfillmentProgress, allocationReview: 'approved' } } : row)
    const reviewed = (await list('queue=shipping', bob).expect(200)).body
    expect(reviewed.total).toBe(3)
    expect(reviewed.items.find((row: any) => row.id === 'ready').fulfillmentProgress.allocationReview).toBe('approved')
    records = records.map(row => row.id === 'ready' ? { ...row, fulfillmentProgress: { ...row.fulfillmentProgress, outbound: 'completed' } } : row)
    expect((await list('queue=shipping', bob).expect(200)).body.total).toBe(2)
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: [] })
    expect((await list('queue=shipping', bob).expect(200)).body.total).toBe(0)
  })

  it('only offers the four reporting departments without dropping other authorized tasks', async () => {
    records = [order('sales', { department: { id: 'd1', name: '\u4e1a\u52a1\u4e00\u90e8' }, salesDepartmentCode: 'sales1' }),
      order('other', { department: { id: 'operations', name: '\u8fd0\u8425\u4e2d\u5fc3' }, salesDepartmentCode: 'sales1' }),
      order('extra', { department: { id: 'sales5', name: '\u4e1a\u52a1\u4e94\u90e8' } }),
      order('unknown', { department: { id: 'unmapped', name: '\u4e1a\u52a1\u4e00\u90e8' } })]
    provider.resolvePermissions = async (subject: any) => ({ subject, allowedOrderIds: records.map(row => row.id) })
    const result = (await list().expect(200)).body
    expect(result.total).toBe(4)
    expect(result.departments).toEqual([{ id: 'd1', name: '\u4e1a\u52a1\u4e00\u90e8' }])
    expect((await list('queue=review&departmentId=d1').expect(200)).body.total).toBe(1)
  })

  it('keeps department options and forged filters inside the employee or manager scope', async () => {
    records = [order('mine', { department: { id: 'd1', name: '业务一部' }, salesDepartmentCode: 'sales1', departmentPathIds: ['company', 'd1'] }),
      order('colleague', { owner: { id: 'colleague', name: 'Colleague' }, department: { id: 'team', name: '自定义小组' }, departmentPathIds: ['company', 'd1', 'team'] }),
      order('outside', { owner: { id: 'other', name: 'Other' }, department: { id: 'd2', name: '业务二部' }, salesDepartmentCode: 'sales2', departmentPathIds: ['company', 'd2'] })]
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: records.map(r => r.id) })
    expect((await list().expect(200)).body.departments).toEqual([{ id: 'd1', name: '业务一部' }])
    expect((await list('queue=review&departmentId=d2').expect(200)).body.total).toBe(0)
    accounts.get(alice).businessRole = 'department_manager'
    accounts.get(alice).businessDepartmentId = 'd1'
    const manager = (await list('queue=review&departmentId=d1').expect(200)).body
    expect(manager.total).toBe(2)
    expect(manager.items.every((item: any) => !('departmentPathIds' in item) && !('tenantId' in item))).toBe(true)
    expect(manager.departments.map((d: any) => d.id).sort()).toEqual(['d1'])
    expect((await list('queue=review&departmentId=d2').expect(200)).body.total).toBe(0)
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [] })
    expect((await list().expect(200)).body.departments).toEqual([])
    await list(`queue=review&departmentId=${'x'.repeat(129)}`).expect(400)
    await list('queue=review&departmentId=d1&departmentId=d2').expect(400)
  })

  it('shows dashboard exceptions in payment order and uses the oldest payment for task time', async () => {
    records = [order('recent', { createdAt: '2019-01-01T01:00:00Z', exception: { reason: 'stock', hours: 200 } }),
      order('oldest', { paidAt: '2020-01-01T09:30:00+08:00', exception: { reason: 'stock', hours: 1 } })]
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: records.map(r => r.id) })
    const result = (await dashboard().expect(200)).body
    expect(result.exceptions.map((r: any) => r.id)).toEqual(['OLDEST', 'RECENT'])
    expect(result.tasks.find((t: any) => t.kind === 'review').time).toBe('09:30')
  })

  it('fails closed for missing configuration, permission failures and provider failures', async () => {
    provider.isConfigured = () => false
    expect((await access().expect(200)).body.status).toBe('not_configured')
    expect((await list().expect(503)).body.code).toBe('fop_not_configured')
    provider.isConfigured = () => true
    provider.resolvePermissions = async () => ({ subject: { tenantId: 'tenant-1', userId: 'bob-fop' }, allowedOrderIds: ['a'] })
    expect((await access().expect(200)).body.status).toBe('denied')
    await list().expect(403)
    provider.resolvePermissions = async () => { throw new Error('secret provider diagnostic') }
    expect((await access().expect(200)).body.status).toBe('unavailable')
    const unavailable = await list().expect(503)
    expect(JSON.stringify(unavailable.body)).not.toContain('secret provider diagnostic')
    provider.resolvePermissions = async () => { throw new ServiceUnavailableException('secret provider diagnostic') }
    expect(JSON.stringify((await list().expect(503)).body)).not.toContain('secret provider diagnostic')
  })

  it('rereads permissions on each request and rejects binding changes during provider work', async () => {
    await list().expect(200)
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [] })
    expect((await list().expect(200)).body.total).toBe(0)
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['a'] })
    provider.listOrders = async () => {
      accounts.get(alice).fopUserId = 'replacement-user'
      return records
    }
    await list().expect(403)
    accounts.get(alice).fopUserId = 'alice-fop'
    provider.resolvePermissions = async (identity: any) => {
      accounts.get(alice).fopTenantId = null
      accounts.get(alice).fopUserId = null
      return { subject: identity, allowedOrderIds: ['a'] }
    }
    expect((await access().expect(200)).body.status).toBe('unbound')
  })

  it('rejects role revocation during provider work and invalid dashboard ranges', async () => {
    provider.listOrders = async () => { accounts.get(alice).workbenchRoles = []; return records }
    await list().expect(403)
    for (const query of ['from=2020-02-30&to=2020-03-01&year=2020', 'from=2020-02-01&to=2020-01-01&year=2020', 'from=2020-01-01&to=2025-01-01&year=2020', 'from=2020-01-01&to=2020-01-31&year=1']) {
      await get(`/autoflow/integrations/fop/dashboard?${query}`).expect(400)
    }
  })

  it('does not treat order grants as permission for legacy FOP product costs or logistics catalogs', async () => {
    for (const actor of [alice, bob]) {
      for (const path of ['logistics/custom-channels', 'logistics/custom-channels/standard/actual-channels']) {
        const response = await get(`/autoflow/integrations/fop/${path}`, actor).expect(403)
        expect(response.body.code).toBe('fop_permission_denied')
      }
      await request(app.getHttpServer()).post('/api/autoflow/integrations/fop/products/purchase-costs')
        .auth(token(actor), { type: 'bearer' }).send({
          lineId: '88f90288-6d52-4d0b-bd10-549e4ac937c3', productReference: 'item', unit: 'piece',
          productProfitMarginRate: 20, currency: 'USD', quantityTiers: [{ minQuantity: 1, maxQuantity: 10 }],
        }).expect(403)
    }
  })
  it('protects business role assignment, validates scope and never grants system administrator rights', async () => {
    const scope = (body: object, actor = bob) => request(app.getHttpServer()).put(`/api/users/${alice}/business-scope`).auth(token(actor), { type: 'bearer' }).send(body)
    await scope({ role: 'admin', departmentId: null, employeeId: null }, alice).expect(403)
    for (const body of [{ role: 'unknown', departmentId: null, employeeId: null }, { role: 'department_manager', departmentId: null, employeeId: null }, { role: 'salesperson', departmentId: null, employeeId: null }, { role: 'admin' }]) await scope(body).expect(400)
    const saved = await scope({ role: 'admin', departmentId: null, employeeId: null }).expect(200)
    expect(saved.body.businessScope.role).toBe('admin')
    expect(saved.body.role).toBe('user')
    expect(saved.body).not.toHaveProperty('password')
    await get('/users/workbench-accounts', alice).expect(403)
    await request(app.getHttpServer()).put('/api/users/profile').auth(token(alice), { type: 'bearer' }).send({ businessRole: 'admin', businessEmployeeId: 'someone-else' }).expect(400)
    await scope({ role: 'salesperson', departmentId: null, employeeId: 'other-owner' }).expect(200)
    expect((await list().expect(200)).body.total).toBe(0)
  })

})
