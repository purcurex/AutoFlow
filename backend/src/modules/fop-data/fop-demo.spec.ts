import { ORGANIZATION_EMPLOYEE_SEEDS, ORGANIZATION_NODE_SEEDS } from '../organization/organization.seed'
import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopOrderCandidate, FopIdentity, UnconfiguredFopDataProvider } from './fop-data.types'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'

const users = { findById: async (id: string) => ({ id, role: UserRole.ADMIN, businessRole: 'admin', businessEmployeeId: 'employee-1', fopTenantId: null, fopUserId: null, workbenchRoles: [] }) } as unknown as UsersService
class OptInDemoProvider extends FopDataProvider {
  readonly source = 'mock' as const
  demoIdentity(id: string) { return { tenantId: `demo:${id}`, userId: id } }
  isConfigured() { return true }
  async resolvePermissions(subject: FopIdentity) { return { subject, allowedOrderIds: [] } }
  async listOrders() { return [] }
}

describe('explicit demo identity', () => {
  it('uses the authenticated local identity without requiring or changing a real FOP binding', async () => {
    const data = new FopDataService(users, new OptInDemoProvider())
    expect(await data.getDataAccess('alice')).toMatchObject({ source: 'mock', mode: 'demo', status: 'ready', binding: { tenantId: 'demo:alice', userId: 'alice' } })
  })
  it('keeps unconfigured live accounts unbound', async () => {
    expect(await new FopDataService(users, new UnconfiguredFopDataProvider()).getDataAccess('alice')).toMatchObject({ status: 'unbound', binding: null })
  })
})

import { DemoFopDataProvider } from './fop-demo.provider'
import { FULFILLMENT_QUEUE_ROLES } from '../users/dto/workbench.dto'
const workspace = {
  source: 'mock' as const, canEdit: true as const,
  nodes: [{ id: 'org-1', name: 'HyperZone', kind: 'organization' as const, parentId: null, sortOrder: 0 },
    { id: 'dept-1', name: 'North America', kind: 'department' as const, parentId: 'sales-1', sortOrder: 0 },
    { id: 'sales-1', name: '业务一部', kind: 'department' as const, parentId: 'org-1', sortOrder: 1 },
    { id: 'sales-2', name: '业务二部', kind: 'department' as const, parentId: 'org-1', sortOrder: 2 },
    { id: 'dept-2', name: 'Europe', kind: 'department' as const, parentId: 'sales-2', sortOrder: 1 }],
  employees: [{ id: 'employee-1', name: 'Alice Chen', code: 'EMP001', email: 'alice@example.test', departmentId: 'dept-1', workbenchRoles: ['sales'] },
    { id: 'employee-2', name: 'Ben Wu', code: 'EMP002', email: 'ben@example.test', departmentId: 'dept-2', workbenchRoles: ['sales'] }],
}
const organizations = { getWorkspace: async (_id: string) => workspace }
const env = { FOP_DATA_MODE: 'demo', NODE_ENV: 'development' }
const query = { from: '2026-10-01', to: '2026-10-21', year: 2026 }

describe('isolated mock FOP dataset', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z')) })
  afterEach(() => jest.useRealTimers())
  it('requires explicit nonproduction opt-in', () => {
    expect(new DemoFopDataProvider(organizations, {}).isConfigured()).toBe(false)
    expect(new DemoFopDataProvider(organizations, { ...env, NODE_ENV: 'production' }).isConfigured()).toBe(false)
    expect(new DemoFopDataProvider(organizations, env).isConfigured()).toBe(true)
  })
  it('populates all six authorized queues with attributed items and consistent dashboard counts', async () => {
    const data = new FopDataService(users, new DemoFopDataProvider(organizations, env))
    const dashboard = await data.getDashboard('alice', query)
    let count = 0
    for (const queue of Object.keys(FULFILLMENT_QUEUE_ROLES) as (keyof typeof FULFILLMENT_QUEUE_ROLES)[]) {
      const orders = await data.getOrders('alice', { queue, page: 1, pageSize: 100 })
      expect(orders.source).toBe('mock')
      expect(orders.total).toBeGreaterThan(10)
      count += orders.total
      expect(orders.items[0]).toMatchObject({ organization: { id: 'org-1', name: 'HyperZone' }, department: { id: expect.any(String), name: expect.any(String) }, owner: { id: expect.any(String), name: expect.any(String) } })
      expect(orders.items[0].items[0]).toMatchObject({ sku: expect.any(String), productId: expect.any(String), imageUrl: expect.stringContaining('data:image/svg+xml'), quantity: expect.any(Number) })
      expect(orders.items[0]).not.toHaveProperty('tenantId')
      if (queue in dashboard.queues) expect(dashboard.queues[queue as keyof typeof dashboard.queues]).toBe(orders.total)
    }
    expect(count).toBeGreaterThan(100)
    expect(dashboard.source).toBe('mock')
    expect(dashboard.registrations).toHaveLength(21)
    expect(dashboard.rates.length).toBeGreaterThan(2)
    expect(dashboard.tasks.every(task => /^\d{2}:\d{2}$/.test(task.time))).toBe(true)
    expect(dashboard.receipts.months).toHaveLength(10)
    expect(dashboard.receipts.departments.map(dept => dept.name)).toEqual(['业务一部', '业务二部', '业务三部', '业务四部'])
    expect((dashboard.receipts.departments as {amounts:number[]}[])[0].amounts.some((amount: number) => amount > 0)).toBe(true)
  })
  it('uses independent fulfillment facts, excludes unpaid orders, and counts overlapping queues once per order', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    const seeds = await provider.listOrders(identity, grant)
    const progress = { shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'approved', outbound: 'completed' } as const
    const examples = [
      { orderNumber: 'PAID-REVIEW', reviewStatus: 'pending' as const },
      { orderNumber: 'UNPAID-REVIEW', reviewStatus: 'pending' as const, paymentStatus: 'unpaid' as const },
      { orderNumber: 'OVERLAP', fulfillmentProgress: { ...progress, shopifySync: 'pending' as const, supplierShipment: 'pending' as const, stockReadiness: 'incomplete' as const, allocationReview: 'pending' as const, outbound: 'pending' as const } },
      { orderNumber: 'READY-REVIEW', fulfillmentProgress: { ...progress, allocationReview: 'pending' as const, outbound: 'pending' as const } },
      { orderNumber: 'READY-OUTBOUND', fulfillmentProgress: { ...progress, outbound: 'pending' as const } },
      { orderNumber: 'PARTIAL', fulfillmentProgress: { ...progress, shopifySync: 'partial' as const, supplierShipment: 'partial' as const, stockReadiness: 'incomplete' as const, allocationReview: 'pending' as const, outbound: 'pending' as const } },
      { orderNumber: 'PARTIAL-OUTBOUND', fulfillmentProgress: { ...progress, outbound: 'partial' as const } },
      { orderNumber: 'CANCELLED', cancelled: true, fulfillmentProgress: { ...progress, shopifySync: 'pending' as const } },
      { orderNumber: 'REFUNDED', paymentStatus: 'refunded' as const, fulfillmentProgress: { ...progress, outbound: 'pending' as const } },
      { orderNumber: 'UNKNOWN', fulfillmentProgress: { shopifySync: 'unknown', supplierShipment: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', outbound: 'unknown' } as const },
      { orderNumber: 'COMPLETE' },
    ]
    provider.listOrders = async () => {
      const rows = examples.map<FopOrderCandidate>((row, index) => ({ ...seeds[index], reviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, exception: null,
        // Deliberately conflicting legacy fields must not drive the new queues.
        procurementStatus: 'purchased', allocationStatus: 'allocated', dispatchStatus: 'dispatched', shippingStatus: 'shipped',
        fulfillmentProgress: progress, ...row,
      }))
      return [...rows, rows[2]]
    }
    const data = new FopDataService(users, provider)
    const expected = { review: ['PAID-REVIEW'], dispatch: ['OVERLAP', 'PARTIAL'], procurement: ['OVERLAP', 'PARTIAL'], allocation: ['OVERLAP', 'READY-REVIEW', 'PARTIAL'], shipping: ['READY-OUTBOUND', 'PARTIAL-OUTBOUND'] }
    for (const queue of Object.keys(expected) as (keyof typeof expected)[]) {
      const result = await data.getOrders('alice', { queue, page: 1, pageSize: 100 })
      expect(result.items.map(row => row.orderNumber).sort()).toEqual(expected[queue].sort())
      expect(result.totals.orderCount).toBe(expected[queue].length)
    }
    const dashboard = await data.getDashboard('alice', query)
    expect(dashboard.queues).toEqual({ review: 1, dispatch: 2, procurement: 2, allocation: 3, shipping: 2 })
    expect(dashboard.tasks.map(task => task.kind)).toEqual(['review', 'dispatch', 'procurement', 'allocation', 'shipping'])
  })
  it('fails closed for missing or invalid progress instead of inventing pending counts', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const original = provider.listOrders.bind(provider)
    provider.listOrders = async (identity, grant) => (await original(identity, grant)).map(row => {
      Reflect.deleteProperty(row, 'fulfillmentProgress')
      return row
    })
    const data = new FopDataService(users, provider)
    await expect(data.getDashboard('alice', query)).rejects.toMatchObject({ response: { code: 'fop_unavailable' } })
    await expect(data.getOrders('alice', { queue: 'allocation', page: 1, pageSize: 20 })).rejects.toMatchObject({ response: { code: 'fop_unavailable' } })
  })
  it('displays the oldest task creation time in UTC+8 across timestamp offsets', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const listOrders = provider.listOrders.bind(provider)
    provider.listOrders = async (identity, grant) => (await listOrders(identity, grant)).map((row, index) => ({
      ...row, createdAt: index === 0 ? '2026-10-01T23:30:00-04:00' : '2026-10-02T02:00:00Z',
    }))
    const dashboard = await new FopDataService(users, provider).getDashboard('alice', query)
    expect(dashboard.tasks.find(task => task.kind === 'review')?.time).toBe('10:00')
  })
  it('isolates tenants and rejects forged identity or another tenant grant', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const a = { tenantId: 'demo:alice', userId: 'alice' }, b = { tenantId: 'demo:bob', userId: 'bob' }
    const grantA = await provider.resolvePermissions(a), grantB = await provider.resolvePermissions(b)
    expect(grantA.allowedOrderIds.some(id => grantB.allowedOrderIds.includes(id))).toBe(false)
    await expect(provider.listOrders(b, grantA)).rejects.toThrow()
    await expect(provider.listReceipts(b, grantA)).rejects.toThrow()
    await expect(provider.resolvePermissions({ tenantId: 'demo:alice', userId: 'bob' })).rejects.toThrow()
    const rows = await provider.listOrders(a, { subject: a, allowedOrderIds: [grantA.allowedOrderIds[0]] })
    expect(rows).toHaveLength(1)
    expect(rows[0].tenantId).toBe('demo:alice')
    const receipts = await provider.listReceipts(a, { ...grantA, allowedOrderIds: [], allowedReceiptIds: [grantA.allowedReceiptIds![0]] })
    expect(receipts).toHaveLength(1)
    expect(receipts[0].tenantId).toBe('demo:alice')
    expect(await provider.listReceipts(a, { ...grantA, allowedReceiptIds: [] })).toEqual([])
  })
  it('provides six named demo carriers with independent warehouse and monthly distributions', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    const orders = await provider.listOrders(identity, grant)
    const labels = { YT: '云途YT', '4PX': '4PX', WB: '万邦WB', YW: '燕文YW', JS: '极速JS', OTHER: '其他' }
    expect(orders.every(order => order.carrierCode && order.carrier === labels[order.carrierCode as keyof typeof labels])).toBe(true)
    const current = orders.filter(order => order.createdAt.startsWith('2026'))
    for (const code of Object.keys(labels)) {
      const rows = current.filter(order => order.carrierCode === code)
      expect(new Set(rows.map(order => order.warehouseCode))).toEqual(new Set(['HZ', 'SZ']))
      expect(new Set(rows.map(order => order.createdAt.slice(0, 7))).size).toBeGreaterThan(1)
    }
    const yt = current.filter(order => order.carrierCode === 'YT').length
    const other = current.filter(order => order.carrierCode === 'OTHER').length
    expect(yt).toBeGreaterThan(other)
  })
  it('provides independent actual freight with six carriers, explicit FX, prior-year baseline and scoped IDs', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    expect(grant.analyticsScopes).toContain('freight')
    const rows = await provider.listFreight(identity, grant)
    expect(new Set(rows.map(r => r.carrierCode))).toEqual(new Set(['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER']))
    expect(new Set(rows.map(r => r.originalCurrency)).size).toBeGreaterThan(1)
    expect(rows.some(r => r.confirmedAt?.startsWith('2021-'))).toBe(true)
    const data = new FopDataService(users, provider)
    const summary = await data.getFreight('alice', { grain: 'month', year: 2026, warehouse: 'ALL' })
    expect(summary.series.every(series => series.totals.amount > 0)).toBe(true)
    const detail = await data.getFreightDetails('alice', { grain: 'month', year: 2026, warehouse: 'ALL', workbenchRole: 'dispatch', page: 1, pageSize: 1 })
    expect(detail.totals.amount).toBe(summary.totals.amount)
    expect(detail.total).toBe(summary.billCount)
    expect(await provider.listFreight(identity, { ...grant, allowedFreightIds: [] })).toEqual([])
    await expect(provider.listFreight({ tenantId: 'demo:bob', userId: 'bob' }, grant)).rejects.toThrow()
  })
  it('reflects employee renaming and reassignment on the next refresh', async () => {
    const current = structuredClone(workspace)
    const provider = new DemoFopDataProvider({ getWorkspace: async () => current }, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    const old = (await provider.listOrders(identity, grant)).find(order => order.owner?.id === 'employee-1')!
    current.employees[0].name = 'Alice Renamed'
    current.employees[0].departmentId = 'dept-2'
    const updated = (await provider.listOrders(identity, grant)).find(order => order.id === old.id)!
    expect(updated).toMatchObject({ owner: { name: 'Alice Renamed' }, department: { id: 'dept-2', name: 'Europe' }, salesDepartmentCode: 'sales2' })
    const receipt = (await provider.listReceipts(identity, grant)).find(row => row.owner?.id === 'employee-1')!
    expect(receipt).toMatchObject({ owner: { name: 'Alice Renamed' }, department: { id: 'dept-2', name: 'Europe' }, salesDepartmentCode: 'sales2' })
  })
  it('uses range and year filters for charts while keeping queues stable and receipts scoped', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const data = new FopDataService(users, provider)
    const first = await data.getDashboard('alice', query)
    const second = await data.getDashboard('alice', { from: '2026-10-10', to: '2026-10-12', year: 2025 })
    expect(second.registrations).toHaveLength(3)
    expect(second.registrations).toEqual(first.registrations.slice(9, 12))
    expect(second.queues).toEqual(first.queues)
    expect(second.receipts.months).toHaveLength(12)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const receipts = await provider.listReceipts(identity, await provider.resolvePermissions(identity))
    const paid = receipts.filter(receipt => receipt.paymentStatus === 'paid' && receipt.reviewStatus === 'approved' && receipt.receiptReviewStatus === 'approved' && receipt.sourceType !== 'deposit_stock' && !receipt.cancelled && receipt.currency === 'USD' && receipt.paidAt?.startsWith('2026'))
    const expectedCents = paid.reduce((sum, receipt) => sum + Math.round(receipt.amount * 100), 0)
    expect(Math.round((first.receipts.departments as {amounts:number[]}[]).reduce((sum, dept) => sum + dept.amounts.reduce((a, b) => a + b, 0), 0) * 100)).toBe(expectedCents)
  })
  it('reconciles each department with its salespeople and excludes non-sales departments', async () => {
    const current = structuredClone(workspace)
    current.employees.push({ ...current.employees[0], id: 'employee-3', name: 'Another salesperson', code: 'EMP003' })
    current.employees.push({ ...current.employees[0], id: 'employee-4', name: 'Warehouse owner', code: 'EMP004', departmentId: 'org-1' })
    const provider = new DemoFopDataProvider({ getWorkspace: async () => current }, env)
    const dashboard = await new FopDataService(users, provider).getDashboard('alice', query)
    expect(dashboard.receipts.departments[0].salespeople.map(person => person.id)).toEqual(['employee-1', 'employee-3'])
    for (const department of dashboard.receipts.departments) {
      department.amounts.forEach((amount, month) => expect(Math.round(amount * 100)).toBe(department.salespeople.reduce((sum, person) => sum + Math.round(person.amounts[month] * 100), 0)))
    }
    expect(dashboard.receipts.departments.flatMap(dept => dept.salespeople).map(person => person.id)).not.toContain('employee-4')
  })
  it('reconciles daily registrations by department and employee within the selected range', async () => {
    const data = new FopDataService(users, new DemoFopDataProvider(organizations, env))
    const first = await data.getDashboard('alice', query)
    const narrowed = await data.getDashboard('alice', { ...query, from: '2026-10-10', to: '2026-10-12' })
    expect(first.registrationDepartments.map(dept => dept.id)).toEqual(['sales1', 'sales2'])
    for (const [day, total] of first.registrations.entries()) {
      expect(total.count).toBe(first.registrationDepartments.reduce((sum, dept) => sum + dept.counts[day], 0))
      for (const dept of first.registrationDepartments) expect(dept.counts[day]).toBe(dept.salespeople.reduce((sum, person) => sum + person.counts[day], 0))
    }
    expect(narrowed.registrationDepartments[0].counts).toEqual(first.registrationDepartments[0].counts.slice(9, 12))
    expect(first.registrationDepartments[0].salespeople[0].id).toBe('employee-1')
    expect(first.receipts.marketingCenter?.amounts.map(amount => Math.round(amount * 100))).toEqual(first.receipts.months.map((_, month) => first.receipts.departments.reduce((sum, dept) => sum + Math.round(dept.amounts[month] * 100), 0)))
  })
  it('does not expose registration dimensions or marketing totals without those analytics grants', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    jest.spyOn(provider, 'resolvePermissions').mockResolvedValue({ ...grant, analyticsScopes: ['rates'], organizationSummaries: [] })
    const dashboard = await new FopDataService(users, provider).getDashboard('alice', query)
    expect(dashboard.registrations).toEqual([])
    expect(dashboard.registrationDepartments).toEqual([])
    expect(dashboard.receipts.marketingCenter).toBeNull()
  })
  it('uses the confirmed bilingual sales roster, including partners, across registrations and receipts', async () => {
    const reference = {
      nodes: ORGANIZATION_NODE_SEEDS.map((node, sortOrder) => ({ id: node.key, name: node.name, parentId: node.parent, kind: (node.parent ? 'department' : 'organization') as 'department' | 'organization', sortOrder })),
      employees: ORGANIZATION_EMPLOYEE_SEEDS.map(employee => ({ id: employee.code, code: employee.code, name: employee.name, email: 'mock@example.test', departmentId: employee.department, workbenchRoles: employee.roles })),
    }
    // A warehouse employee in a sales department must not become a salesperson.
    reference.employees.push({ id: 'warehouse', code: 'WAREHOUSE', name: 'Non-sales staff', email: 'mock@example.test', departmentId: 'europe', workbenchRoles: ['warehouse'] })
    const dashboard = await new FopDataService(users, new DemoFopDataProvider({ getWorkspace: async () => reference }, env)).getDashboard('alice', query)
    expect(dashboard.registrationDepartments.map(dept => dept.salespeople.length)).toEqual([5, 4, 5, 1])
    const names = dashboard.registrationDepartments.flatMap(dept => dept.salespeople.map(person => person.name))
    expect(names).toContain('曹可滢（Ruth）')
    expect(names).toContain('杨莹（Kiki）')
    expect(names.every(name => /（[A-Za-z]+）$/.test(name))).toBe(true)
    expect(names).not.toContain('Non-sales staff')
    expect(dashboard.receipts.departments.flatMap(dept => dept.salespeople.map(person => person.name)).sort()).toEqual([...names].sort())
    for (const leader of ['陈艳群', '崔雨婷', '刘梦', '袁倩倩', '黄音音']) expect(names.some(name => name.startsWith(leader))).toBe(false)
  })
  it('provides a separate profit contribution ledger with frozen monthly snapshots, dated adjustments and current estimated events', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    expect(grant.analyticsScopes).toContain('sales_profit')
    const profits = await provider.listProfits(identity, grant)
    expect(profits.some(row => row.status === 'settled' && row.recognitionDate === null)).toBe(true)
    expect(profits.some(row => row.status === 'settled' && row.recognitionDate !== null && row.amount < 0)).toBe(true)
    expect(profits.some(row => row.status === 'estimated' && row.freightBasis === 'estimated' && row.recognitionMonth === '2026-10')).toBe(true)
    expect(profits.some(row => Date.parse(row.knownAt) > Date.now())).toBe(true)
    expect(await provider.listProfits(identity, { ...grant, allowedProfitIds: [] })).toEqual([])
    await expect(provider.listProfits(identity, { ...grant, analyticsScopes: ['receipts'] })).rejects.toThrow()
    const data = new FopDataService(users, provider)
    const monthly = await data.getSalesPerformance('alice', { from: '2026-01-01', to: '2026-10-21', grain: 'month' })
    expect(monthly).toMatchObject({ source: 'mock', selectedOwner: { id: 'employee-1' }, canSelectOwner: true })
    expect(monthly.totals.settledGrossProfit).toBeGreaterThan(0)
    expect(monthly.totals.estimatedGrossProfit).toBeGreaterThan(0)
    const daily = await data.getSalesPerformance('alice', { from: '2026-09-01', to: '2026-09-30', grain: 'day' })
    expect(daily.totals.settledGrossProfit).toBeNull()
    expect(daily.unallocatedSettlements).toHaveLength(1)
    const details = await data.getSalesPerformanceDetails('alice', { from: '2026-01-01', to: '2026-10-21', grain: 'month', kind: 'profit', page: 1, pageSize: 1 })
    expect(details.totals).toEqual(monthly.totals)
    expect(details.profits.every(row => Date.parse(row.knownAt) <= Date.now())).toBe(true)
  })
  it('still enforces local workbench roles in demo mode', async () => {
    const restricted = { findById: async () => ({ role: UserRole.USER, businessRole: 'salesperson', businessEmployeeId: 'employee-1', workbenchRoles: ['sales'], fopTenantId: null, fopUserId: null }) } as unknown as UsersService
    const data = new FopDataService(restricted, new DemoFopDataProvider(organizations, env))
    await expect(data.getOrders('alice', { queue: 'shipping', page: 1, pageSize: 20 })).rejects.toThrow('Workbench access denied')
    const dash = await data.getDashboard('alice', query)
    expect(dash.queues.shipping).toBe(0)
    expect(dash.queues.review).toBeGreaterThan(0)
  })
})

describe('analytics boundary validation', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z')) })
  afterEach(() => jest.useRealTimers())
  it('fails closed on malformed upstream chart values', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    jest.spyOn(provider, 'getAnalytics').mockResolvedValue({ subject: { tenantId: 'demo:alice', userId: 'alice' }, rates: [{ currency: 'USD', cnyPerUnit: NaN }], registrations: [{ date: '2026-10-12', count: -1 }] })
    await expect(new FopDataService(users, provider).getDashboard('alice', query)).rejects.toMatchObject({ status: 503 })
  })
  it('rejects analytics that belongs to a different employee', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    jest.spyOn(provider, 'getAnalytics').mockResolvedValue({ subject: { tenantId: 'demo:bob', userId: 'bob' }, rates: [], registrations: [] })
    await expect(new FopDataService(users, provider).getDashboard('alice', query)).rejects.toMatchObject({ status: 403 })
  })
  it('computes receipts using only the permission allowlist', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    const one = (await provider.listReceipts(identity, grant)).find(receipt => receipt.paymentStatus === 'paid' && receipt.reviewStatus === 'approved' && receipt.receiptReviewStatus === 'approved' && receipt.sourceType === 'full_payment_stock' && receipt.paidAt?.startsWith('2026'))!
    jest.spyOn(provider, 'resolvePermissions').mockResolvedValue({ ...grant, allowedOrderIds: [], allowedReceiptIds: [one.id] })
    const dashboard = await new FopDataService(users, provider).getDashboard('alice', query)
    expect(dashboard.receipts.departments).toHaveLength(4)
    const department = dashboard.receipts.departments.find(dept => dept.id === one.salesDepartmentCode)!
    expect(dashboard.receipts.departments.flatMap(dept => dept.salespeople)).toMatchObject([{ id: one.owner!.id, name: one.owner!.name, previousAmount: 0, amounts: department.amounts }])
    expect(dashboard.receipts.departments.flatMap(dept => dept.amounts).reduce((a, b) => a + b, 0)).toBe(one.amount)
  })
  it('includes authorized December receipt baselines without counting them as current-year receipts', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    const identity = { tenantId: 'demo:alice', userId: 'alice' }
    const grant = await provider.resolvePermissions(identity)
    const template = (await provider.listReceipts(identity, grant)).find(receipt => receipt.paymentStatus === 'paid' && receipt.reviewStatus === 'approved' && receipt.receiptReviewStatus === 'approved' && receipt.sourceType !== 'deposit_stock' && receipt.owner?.id === 'employee-1')!
    const receipts = [
      { ...template, id: 'dec', documentNumber: 'DEC', paidAt: '2025-12-15T12:00:00Z', amount: 80 },
      { ...template, id: 'jan', documentNumber: 'JAN', paidAt: '2026-01-15T12:00:00Z', amount: 100 },
      { ...template, id: 'excluded', documentNumber: 'EXCLUDED', paidAt: '2025-12-15T12:00:00Z', amount: 9999 },
    ]
    jest.spyOn(provider, 'resolvePermissions').mockResolvedValue({ ...grant, allowedOrderIds: [], allowedReceiptIds: ['dec', 'jan'] })
    jest.spyOn(provider, 'listReceipts').mockResolvedValue(receipts)
    const dashboard = await new FopDataService(users, provider).getDashboard('alice', query)
    expect(dashboard.receipts).toMatchObject({ previousMonth: '2025-12', marketingCenter: { previousAmount: 80 } })
    const department = dashboard.receipts.departments.find(dept => dept.id === template.salesDepartmentCode)!
    expect(department).toMatchObject({ previousAmount: 80, salespeople: [{ id: 'employee-1', previousAmount: 80 }] })
    expect(department.amounts.reduce((sum, amount) => sum + amount, 0)).toBe(100)
  })
  it('does not manufacture an identity when demo mode is disabled', () => {
    expect(new DemoFopDataProvider(organizations, { NODE_ENV: 'development' }).demoIdentity('alice')).toBeNull()
    expect(new DemoFopDataProvider(organizations, { ...env, NODE_ENV: 'production' }).demoIdentity('alice')).toBeNull()
  })
})

describe('business role data scope', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z')) })
  afterEach(() => jest.useRealTimers())
  const user = (scope: object) => ({ role: UserRole.USER, workbenchRoles: ['sales', 'allocation', 'dispatch', 'warehouse', 'procurement'], ...scope })
  const service = (account: object, provider = new DemoFopDataProvider(organizations, env)) => new FopDataService({ findById: async () => ({ ...account }) } as unknown as UsersService, provider)
  it('filters orders, queues, registrations and receipts before calculating totals', async () => {
    const admin = service(user({ businessRole: 'admin' }))
    const manager = service(user({ businessRole: 'department_manager', businessDepartmentId: 'sales-1' }))
    const sales = service(user({ businessRole: 'salesperson', businessEmployeeId: 'employee-1' }))
    const all = await admin.getDashboard('alice', query)
    const dept = await manager.getDashboard('alice', query)
    const own = await sales.getDashboard('alice', query)
    expect(dept.registrations).toEqual(own.registrations)
    expect(dept.receipts.departments).toEqual(own.receipts.departments)
    expect(dept.receipts.marketingCenter?.amounts).toEqual(own.receipts.marketingCenter?.amounts)
    expect(dept.registrations.reduce((sum, row) => sum + row.count, 0)).toBeLessThan(all.registrations.reduce((sum, row) => sum + row.count, 0))
    expect(dept.registrationDepartments.flatMap(row => row.salespeople).map(row => row.id)).toEqual(['employee-1'])
    expect(dept.receipts.departments[1].amounts.every(value => value === 0)).toBe(true)
    for (const queue of Object.keys(FULFILLMENT_QUEUE_ROLES) as (keyof typeof FULFILLMENT_QUEUE_ROLES)[]) {
      const scoped = await manager.getOrders('alice', { queue, page: 1, pageSize: 100 })
      expect(scoped.total).toBeGreaterThan(0)
      expect(scoped.items.every(row => row.owner?.id === 'employee-1')).toBe(true)
      if (queue in dept.queues) expect(dept.queues[queue as keyof typeof dept.queues]).toBe(scoped.total)
      const foreign = (await admin.getOrders('alice', { queue, page: 1, pageSize: 100 })).items.find(row => row.owner?.id === 'employee-2')!
      expect((await manager.getOrders('alice', { queue, page: 1, pageSize: 1, orderNumber: foreign.orderNumber })).total).toBe(0)
    }
  })
  it('grants business administrators every workbench without needing system administrator privileges', async () => {
    const data = service({ role: UserRole.USER, businessRole: 'admin', workbenchRoles: [] })
    expect((await data.getOrders('alice', { queue: 'shipping', page: 1, pageSize: 10 })).total).toBeGreaterThan(0)
  })
  it.each([{ businessRole: 'salesperson' }, { businessRole: 'department_manager' }])('fails closed when a required assignment is missing: %j', async scope => {
    await expect(service(user(scope)).getDashboard('alice', query)).rejects.toMatchObject({ response: { code: 'business_scope_required' } })
  })
  it('discards results if the role is revoked while the provider is loading', async () => {
    const account = user({ businessRole: 'admin' }) as any
    const provider = new DemoFopDataProvider(organizations, env)
    const original = provider.listOrders.bind(provider)
    provider.listOrders = async (...args) => { const result = await original(...args); account.businessRole = 'salesperson'; account.businessEmployeeId = 'employee-1'; return result }
    await expect(service(account, provider).getDashboard('alice', query)).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
  })
  it('never exposes unscoped legacy aggregate analytics to managers', async () => {
    const provider = new DemoFopDataProvider(organizations, env)
    provider.getAnalytics = async identity => ({ subject: identity, rates: [], registrations: [{ date: query.from, count: 999999 }] })
    const resolve = provider.resolvePermissions.bind(provider)
    provider.resolvePermissions = async identity => ({ ...await resolve(identity), organizationSummaries: [] })
    expect((await service(user({ businessRole: 'department_manager', businessDepartmentId: 'sales-1' }), provider).getDashboard('alice', query)).registrations).toEqual([])
  })
})


describe('demo independent organization summary', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z')))
  afterEach(() => jest.useRealTimers())
  it('gives each owner more than ten distinct current customers without sharing another owner customer ID', async () => {
    const provider = new DemoFopDataProvider(organizations, env), identity = provider.demoIdentity('alice')!
    const orders = await provider.listOrders(identity, await provider.resolvePermissions(identity))
    const one = new Set(orders.filter(o => o.owner?.id === 'employee-1').map(o => o.customerId))
    const two = new Set(orders.filter(o => o.owner?.id === 'employee-2').map(o => o.customerId))
    expect(one.size).toBeGreaterThan(10); expect(two.size).toBeGreaterThan(10)
    expect([...one].some(id => two.has(id))).toBe(false)
    expect(orders.every(o => o.currentCustomerOwner?.id === o.owner?.id)).toBe(true)
  })
  it('returns authorized department metrics with empty raw-resource grants and no record identity', async () => {
    const provider = new DemoFopDataProvider(organizations, env), identity = provider.demoIdentity('alice')!
    const grant = await provider.resolvePermissions(identity)
    const context = { ...grant, allowedOrderIds: [], allowedReceiptIds: [] }
    const result = await provider.getOrganizationSummary(identity, context, { chartId: 'department_receipts', departments: ['sales1'], from: '2026-01-01', to: '2026-10-21' })
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every(r => r.salesDepartmentCode === 'sales1' && r.currency === 'USD')).toBe(true)
    expect(result.rows.some(r => r.sourceType === 'full_payment_stock' && r.amount! > 0)).toBe(true)
    for (const row of result.rows) for (const key of ['owner', 'customerId', 'documentId', 'orderId']) expect(row).not.toHaveProperty(key)
    await expect(provider.getOrganizationSummary(identity, { ...context, organizationSummaries: [] }, { chartId: 'department_receipts', departments: ['sales1'], from: '2026-01-01', to: '2026-10-21' })).rejects.toThrow()
  })
})
