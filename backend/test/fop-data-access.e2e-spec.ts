import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import * as request from 'supertest'
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

  beforeAll(async () => {
    const repository = {
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
        isConfigured: () => provider.isConfigured(),
        resolvePermissions: (identity: any) => provider.resolvePermissions(identity),
        listOrders: (identity: any, grant: any) => provider.listOrders(identity, grant),
        listReceipts: (identity: any, grant: any) => provider.listReceipts(identity, grant),
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
    provider = {
      isConfigured: () => true,
      resolvePermissions: async (identity: any) => ({ subject: { ...identity }, allowedOrderIds: identity.userId === 'alice-fop' ? ['a', 'shared'] : ['b', 'shared'] }),
      listOrders: async () => structuredClone(records),
      listReceipts: async () => structuredClone(receiptRecords),
    }
  })
  afterAll(async () => { await app?.close() })

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
    expect(restricted.body.queues).toEqual({ review: 0, allocation: 1, dispatch: 0, shipping: 0 })
    expect(restricted.body.exceptions).toEqual([])
    expect(restricted.body.tasks.map((task: any) => task.kind)).toEqual(['allocation'])
  })

  it('returns empty data for an empty allowlist, including for administrators', async () => {
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: [] })
    provider.listOrders = () => { throw new Error('Must not enumerate without allowed IDs') }
    expect((await access(bob).expect(200)).body.status).toBe('ready')
    expect((await list('queue=review', bob).expect(200)).body.total).toBe(0)
    expect((await dashboard(bob).expect(200)).body.queues.review).toBe(0)
  })

  it('sorts authorized orders deterministically before paging regardless of provider order', async () => {
    records = [order('older', { createdAt: '2019-01-01T00:00:00Z' }), order('new-b'), order('new-a')]
    provider.resolvePermissions = async (identity: any) => ({ subject: identity, allowedOrderIds: ['older', 'new-b', 'new-a'] })
    const first = await list('queue=review&pageSize=1&page=1').expect(200)
    expect(first.body.items.map((item: any) => item.id)).toEqual(['new-a'])
    records.reverse()
    const second = await list('queue=review&pageSize=1&page=2').expect(200)
    expect(second.body.items.map((item: any) => item.id)).toEqual(['new-b'])
    expect(second.body.total).toBe(3)
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
