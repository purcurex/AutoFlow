import { FopProfitCandidate } from '../src/modules/fop-data/sales-performance.types'
import { FopFreightCandidate } from '../src/modules/fop-data/fop-freight.types'
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
    fulfillmentProgress: { shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
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
