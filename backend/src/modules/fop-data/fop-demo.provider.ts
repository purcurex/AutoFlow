import { ApprovalCommand, ApprovalOutcome, ApprovalQueue, ApprovalTarget, approvalEntity } from './fop-approval.types'
import { demoSupplierFollowUps } from './supplier-follow-up-demo'
import { eligibleReceipts } from './fop-receipts'
import { FopOrganizationSummary, FopOrganizationSummaryQuery, FopOrganizationSummaryRow } from './fop-data.types'
import { demoProfits } from './sales-performance-demo'
import type { FopProfitCandidate } from './sales-performance.types'
import { demoFreight } from './fop-freight-demo'
import type { FopFreightCandidate } from './fop-freight.types'
import { businessDate } from './fop-business-time'
import { FOP_CARRIERS } from './fop-carriers'
import { createHash } from 'crypto'
import { FopAnalytics, FopDataProvider, FopIdentity, FopOrderCandidate, DispatchDocument, ProcurementProgress, FopReceiptCandidate, FopPermissionDeniedError, FopPermissionGrant, SALES_DEPARTMENTS, SalesDepartmentCode } from './fop-data.types'

interface DemoWorkspace {
  nodes: { id: string; parentId: string | null; name: string; kind: 'organization' | 'department'; sortOrder: number }[]
  employees: { id: string; name: string; code: string; email: string; departmentId: string; workbenchRoles: readonly string[] }[]
}
interface WorkspaceReader { getWorkspace(ownerUserId: string): Promise<DemoWorkspace> }

function salesDepartmentFor(workspace: DemoWorkspace, departmentId: string): SalesDepartmentCode | undefined {
  const nodes = new Map(workspace.nodes.map(node => [node.id, node]))
  let node = nodes.get(departmentId)
  const seen = new Set<string>()
  while (node && node.kind !== 'organization' && !seen.has(node.id)) {
    const department = SALES_DEPARTMENTS.find(item => item.name === node!.name)
    if (department) return department.id
    seen.add(node.id)
    node = node.parentId ? nodes.get(node.parentId) : undefined
  }
}

function departmentPath(workspace: DemoWorkspace, id: string): string[] {
  const path: string[] = []
  let node = workspace.nodes.find(item => item.id === id)
  while (node && !path.includes(node.id)) {
    path.push(node.id)
    node = workspace.nodes.find(item => item.id === node!.parentId)
  }
  return path
}

const DAY = 86_400_000
const PRODUCTS = [
  { sku: 'HZ-BAG-001', name: 'Everyday commuter backpack', variant: 'Slate blue / 20L', cents: 4890, color: '#627fa8', drawing: '<rect x="39" y="29" width="50" height="72" rx="14"/><path d="M51 31v-8h26v8M49 64h30v26H49z" fill="none" stroke="#fff" stroke-width="4"/>' },
  { sku: 'HZ-LAMP-002', name: 'Nordic rechargeable desk lamp', variant: 'Warm ivory / USB-C', cents: 3250, color: '#d3b588', drawing: '<path d="M38 60l17-35h20l17 35z"/><path d="M64 61v35M45 100h38" fill="none" stroke="#66758c" stroke-width="7"/>' },
  { sku: 'HZ-BOTTLE-003', name: 'Trail vacuum insulated bottle', variant: 'Sage green / 750ml', cents: 2490, color: '#85a89c', drawing: '<rect x="44" y="32" width="40" height="72" rx="12"/><rect x="51" y="20" width="26" height="17" rx="5"/><path d="M53 49v35" stroke="#fff" stroke-width="4" opacity=".6"/>' },
  { sku: 'HZ-HEADSET-004', name: 'AirTune wireless headphones', variant: 'Midnight / Bluetooth 5.3', cents: 6900, color: '#57657e', drawing: '<path d="M35 73V54a29 29 0 0158 0v19" fill="none" stroke="#57657e" stroke-width="10"/><rect x="27" y="59" width="20" height="38" rx="9"/><rect x="81" y="59" width="20" height="38" rx="9"/>' },
  { sku: 'HZ-SHOES-005', name: 'Cloudstep knit running shoes', variant: 'Sand / EU 39', cents: 5490, color: '#cfae93', drawing: '<path d="M29 47l25 9 12 22 32 7 5 15H25z"/><path d="M25 102h78M55 64l17-6M59 72l18-6" stroke="#fff" stroke-width="5"/>' },
  { sku: 'HZ-MUG-006', name: 'Studio ceramic coffee mug', variant: 'Ocean glaze / 350ml', cents: 1890, color: '#72aab6', drawing: '<rect x="32" y="40" width="52" height="57" rx="10"/><path d="M84 49h11a16 16 0 010 32H84" fill="none" stroke="#72aab6" stroke-width="9"/><ellipse cx="58" cy="40" rx="25" ry="7" fill="#d5ecee"/>' },
  { sku: 'HZ-WATCH-007', name: 'Active fitness smart watch', variant: 'Graphite / 42mm', cents: 7990, color: '#4b5d7e', drawing: '<rect x="49" y="13" width="30" height="102" rx="8"/><rect x="35" y="37" width="58" height="55" rx="13" fill="#8799b2"/><rect x="41" y="43" width="46" height="43" rx="8" fill="#243953"/><path d="M49 68h9l5-12 7 20 6-8h8" stroke="#5ce0c4" stroke-width="3" fill="none"/>' },
  { sku: 'HZ-POUCH-008', name: 'Travel cable organizer', variant: 'Terracotta / medium', cents: 1590, color: '#ce917c', drawing: '<rect x="24" y="40" width="80" height="56" rx="13"/><path d="M29 53h70M86 51v12" stroke="#fff" stroke-width="4"/><rect x="50" y="67" width="29" height="13" rx="3" fill="#e8c2b0"/>' },
] as const
const CUSTOMERS = ['Olivia Martin', 'Noah Williams', 'Emma Thompson', 'Liam Anderson', 'Sofia Garcia', 'Lucas Meyer', 'Isabella Rossi', 'Ethan Wilson', 'Mia Johnson', 'Oliver Brown', 'Chloe Laurent', 'Daniel Lee']
const STORES = ['Northstar Living', 'Urban Trail Supply', 'Studio Everyday', 'Evergreen Essentials', 'Coastal Home Market', 'Atlas Lifestyle']
// Stable but varied service mix, independent of warehouse, owner and fulfillment stage.
const CARRIER_THRESHOLDS = [32, 57, 75, 88, 96, 100]

function imageUrl(product: typeof PRODUCTS[number]) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="18" fill="#f1f5f9"/><ellipse cx="64" cy="108" rx="37" ry="5" fill="#dce4ed"/><g fill="${product.color}">${product.drawing}</g></svg>`)}`
}

/** Local demo only. This adapter never writes bindings or attempts an upstream fallback. */
export class DemoFopDataProvider extends FopDataProvider {
  private readonly approved = new Set<string>()
  private readonly approvalRequests = new Map<string, { fingerprint: string; outcome: ApprovalOutcome }>()
  private documentKey(tenantId: string, entity: string, id: string) { return JSON.stringify([tenantId, entity, id]) }
  private allocationIds(order: FopOrderCandidate) { return Array.from({ length: order.items.length > 1 ? 2 : 1 }, (_, i) => `${order.id}:alloc:${i + 1}`) }
  async approvalTargets(identity: Readonly<FopIdentity>, queue: ApprovalQueue, orderId: string): Promise<ApprovalTarget[]> {
    const permission = await this.resolvePermissions(identity)
    if (!permission.approvalActions?.includes(queue) || !permission.allowedOrderIds.includes(orderId)) throw new FopPermissionDeniedError('Approval denied')
    const order = (await this.orders(identity)).find(o => o.id === orderId)
    if (!order) return []
    const entity = approvalEntity(queue)
    const ids = queue === 'review' ? [order.id] : this.allocationIds(order)
    const paid = order.paymentStatus === 'paid' && !order.cancelled
    const dispatchReady = !!order.dispatchDocuments?.length && order.dispatchDocuments.every(d => d.status === 'approved')
    return ids.map((id, index) => {
      const approved = this.approved.has(this.documentKey(identity.tenantId, entity, id)) || (queue === 'review' ? order.reviewStatus === 'approved' : order.fulfillmentProgress.allocationReview === 'approved')
      const eligible = paid && !approved && (queue === 'review' || order.reviewStatus === 'approved' && order.fulfillmentProgress.stockReadiness === 'ready' && dispatchReady && order.fulfillmentProgress.outbound !== 'completed')
      return { tenantId: identity.tenantId, orderId, id, number: queue === 'review' ? order.orderNumber : `PH-${order.orderNumber}-${index + 1}`, entity, version: approved ? '2' : '1', status: approved ? 'C' : 'B', eligible, reason: approved ? '已审核' : !paid ? '订单未支付或已取消' : queue === 'allocation_review' && !dispatchReady ? '关联发运单尚未全部审核，请先在 FOP 完成发运审核' : !eligible ? '配货尚未齐套或单据状态不符' : null }
    })
  }
  async approveDocument(identity: Readonly<FopIdentity>, command: ApprovalCommand): Promise<ApprovalOutcome> {
    const queue = command.entity === 'hzkj_orders' ? 'review' : 'allocation_review'
    const targets = await this.approvalTargets(identity, queue, command.orderId)
    const target = targets.find(d => d.id === command.id && d.entity === command.entity)
    if (!target) throw new FopPermissionDeniedError('Document denied')
    const key = JSON.stringify([identity, command.idempotencyKey])
    const fingerprint = JSON.stringify([command.orderId, command.entity, command.id, command.version, command.operation])
    const existing = this.approvalRequests.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { status: 'blocked', message: '重复请求内容不一致', warning: null }
      return existing.outcome
    }
    const outcome: ApprovalOutcome = target.status === 'C' ? { status: 'already_approved', message: '已审核，无需重复操作', warning: null }
      : !target.eligible || target.version !== command.version || command.operation !== 'audit' ? { status: 'blocked', message: target.reason || '单据已变化，请重新核对', warning: null }
      : { status: 'approved', message: '模拟审核成功', warning: null }
    if (outcome.status === 'approved') this.approved.add(this.documentKey(identity.tenantId, target.entity, target.id))
    this.approvalRequests.set(key, { fingerprint, outcome })
    return outcome
  }

  readonly source = 'mock' as const
  constructor(private readonly organizations: WorkspaceReader, private readonly environment: Record<string, string | undefined> = process.env) { super() }
  isConfigured() { return this.environment.FOP_DATA_MODE === 'demo' && ['development', 'test', 'local'].includes(this.environment.NODE_ENV ?? '') }
  demoIdentity(localUserId: string): FopIdentity | null { return this.isConfigured() ? { tenantId: `demo:${localUserId}`, userId: localUserId } : null }
  private assertIdentity(identity: Readonly<FopIdentity>, permission?: Readonly<FopPermissionGrant>) {
    if (!this.isConfigured() || !identity.userId || identity.tenantId !== `demo:${identity.userId}`
      || (permission && (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId))) throw new FopPermissionDeniedError('Invalid demo identity')
  }
  async resolvePermissions(identity: Readonly<FopIdentity>): Promise<FopPermissionGrant> {
    this.assertIdentity(identity)
    const workspace = await this.organizations.getWorkspace(identity.userId)
    const departments = SALES_DEPARTMENTS.flatMap(d => {
      const node = workspace.nodes.find(node => node.kind === 'department' && node.name === d.name)
      return node ? [{ code: d.id, departmentId: node.id, departmentPathIds: departmentPath(workspace, node.id) }] : []
    })
    const organizationSummaries = (['registrations', 'department_receipts', 'order_volume'] as const).map(chartId => ({ chartId, departments }))
    return { approvalActions: ['review', 'allocation_review'], organizationSummaries, subject: { ...identity }, allowedOrderIds: (await this.orders(identity)).map(order => order.id), allowedPurchaseOrderIds: (await this.orders(identity)).flatMap(order => demoSupplierFollowUps(order).map(row => row.purchaseOrderId)), allowedReceiptIds: (await this.receipts(identity)).map(receipt => receipt.id), allowedFreightIds: demoFreight(identity, await this.orders(identity)).map(row => row.id), allowedProfitIds: demoProfits(identity, await this.orders(identity)).map(row => row.id), analyticsScopes: ['rates', 'registrations', 'receipts', 'freight', 'sales_profit'] }
  }
  async listSupplierFollowUps(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, orderId: string) {
    this.assertIdentity(identity, permission)
    const order = permission.allowedOrderIds.includes(orderId) ? (await this.orders(identity)).find(row => row.id === orderId) : undefined
    const allowed = new Set(permission.allowedPurchaseOrderIds ?? [])
    return { subject: { ...identity }, orderId, items: order ? demoSupplierFollowUps(order).filter(row => allowed.has(row.purchaseOrderId)) : [] }
  }
  async listOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopOrderCandidate[]> {
    this.assertIdentity(identity, permission)
    const allowed = new Set(permission.allowedOrderIds)
    return (await this.orders(identity)).filter(order => allowed.has(order.id))
  }
  async listReceipts(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopReceiptCandidate[]> {
    this.assertIdentity(identity, permission)
    const allowed = new Set(permission.allowedReceiptIds ?? [])
    return (await this.receipts(identity)).filter(receipt => allowed.has(receipt.id))
  }
  async listProfits(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopProfitCandidate[]> {
    this.assertIdentity(identity, permission)
    if (!permission.analyticsScopes?.includes('sales_profit')) throw new FopPermissionDeniedError('Sales profit access denied')
    const allowed = new Set(permission.allowedProfitIds ?? [])
    return demoProfits(identity, await this.orders(identity)).filter(row => allowed.has(row.id))
  }
  async listFreight(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopFreightCandidate[]> {
    this.assertIdentity(identity, permission)
    if (!permission.analyticsScopes?.includes('freight')) throw new FopPermissionDeniedError('Freight cost access denied')
    const allowed = new Set(permission.allowedFreightIds ?? [])
    return demoFreight(identity, await this.orders(identity)).filter(row => allowed.has(row.id))
  }
  async getOrganizationSummary(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, query: Readonly<FopOrganizationSummaryQuery>): Promise<FopOrganizationSummary> {
    this.assertIdentity(identity, permission)
    const allowed = permission.organizationSummaries?.find(g => g.chartId === query.chartId)?.departments.map(d => d.code) ?? []
    if (!query.departments.length || query.departments.some(code => !allowed.includes(code))) throw new FopPermissionDeniedError('Organization summary access denied')
    const rows = new Map<string, FopOrganizationSummaryRow>()
    const add = (row: FopOrganizationSummaryRow) => {
      if (!query.departments.includes(row.salesDepartmentCode) || row.date < query.from || row.date > query.to) return
      const key = JSON.stringify([row.date, row.salesDepartmentCode, row.warehouseCode, row.sourceType])
      const previous = rows.get(key)
      rows.set(key, { ...row, count: (previous?.count ?? 0) + row.count, ...(row.amount !== undefined ? { amount: Math.round(((previous?.amount ?? 0) + row.amount) * 100) / 100 } : {}) })
    }
    // Aggregation belongs to the provider boundary; it never exposes these source facts.
    if (query.chartId === 'department_receipts') {
      for (const receipt of eligibleReceipts(await this.receipts(identity))) if (receipt.currency === 'USD') add({ date: businessDate(receipt.paidAt!), salesDepartmentCode: receipt.salesDepartmentCode!, count: 1, amount: receipt.amount, currency: 'USD', sourceType: receipt.sourceType as 'fulfillment' | 'full_payment_stock' })
    } else if (query.chartId === 'order_volume') {
      for (const order of await this.orders(identity)) if (order.salesDepartmentCode && !order.cancelled && order.reviewStatus === 'approved' && order.paymentStatus === 'paid' && order.paidAt && Date.parse(order.paidAt) <= Date.now()) add({ date: businessDate(order.paidAt), salesDepartmentCode: order.salesDepartmentCode, count: 1, warehouseCode: order.warehouseCode === 'HZ' || order.warehouseCode === 'SZ' ? order.warehouseCode : 'UNASSIGNED' })
    } else {
      const workspace = await this.organizations.getWorkspace(identity.userId)
      for (let at = Date.parse(`${query.from}T00:00:00Z`); at <= Date.parse(`${query.to}T00:00:00Z`); at += DAY) {
        const date = new Date(at).toISOString().slice(0, 10)
        for (const owner of workspace.employees.filter(owner => owner.workbenchRoles.includes('sales'))) {
          const code = salesDepartmentFor(workspace, owner.departmentId)
          if (!code) continue
          const count = createHash('sha256').update(`${identity.tenantId}:registration:${owner.id}:${date}`).digest().readUInt32BE(0) % 18
          add({ date, salesDepartmentCode: code, count })
        }
      }
    }
    return { subject: { ...identity }, chartId: query.chartId, rows: [...rows.values()] }
  }
  private async receipts(identity: Readonly<FopIdentity>): Promise<FopReceiptCandidate[]> {
    const orders = await this.orders(identity)
    const rows: FopReceiptCandidate[] = orders.filter(o => o.salesDepartmentCode && o.paymentStatus === 'paid').map(o => {
      const fee = Math.round(o.amount * 100 * .02) / 100
      return { tenantId: o.tenantId, departmentPathIds: o.departmentPathIds, id: `${o.id}:receipt:1`, sourceType: 'fulfillment', documentId: o.id, documentNumber: o.orderNumber,
        currentCustomerOwner: o.currentCustomerOwner, customerId: o.customerId!, customerCode: o.customerCode!, customerName: o.customerName, organization: o.organization, department: o.department, owner: o.owner, salesDepartmentCode: o.salesDepartmentCode,
        warehouseCode: o.warehouseCode!, warehouse: o.warehouse, carrierCode: o.carrierCode!, amount: Math.round((o.amount - fee) * 100) / 100, orderAmount: o.amount, handlingFee: fee, currency: 'USD', paidAt: o.paidAt,
        reviewStatus: o.reviewStatus, receiptReviewStatus: 'approved', paymentStatus: o.paymentStatus, cancelled: o.cancelled, items: o.items }
    })
    const seen = new Set<string>()
    for (const order of orders.filter(o => o.salesDepartmentCode && o.reviewStatus === 'approved' && o.paidAt)) {
      const month = businessDate(order.paidAt!).slice(0, 7), key = `${order.owner!.id}:${month}`
      if (seen.has(key)) continue
      seen.add(key)
      const base = rows.find(r => r.documentId === order.id)!
      const index = seen.size, amount = 350 + (index % 9) * 85
      rows.push({ ...base, id: `stock:${key}:receipt:1`, sourceType: 'full_payment_stock', documentId: `stock:${key}`, documentNumber: `ST-${month.replace('-', '')}-${String(index).padStart(4, '0')}`,
        amount, orderAmount: amount, handlingFee: 0, carrierCode: null, paidAt: `${month}-05T09:00:00+08:00`,
        ...(index % 5 === 0 ? { customerId: `${identity.tenantId}:stock-customer:${order.owner!.id}:${index % 3}`, customerCode: `STC00${index % 3 + 1}`, customerName: ['Prepaid Supply Co', 'Reserve Living', 'Future Stock Studio'][index % 3] } : {}) })
      if (index % 7 === 0) rows.push({ ...base, id: `deposit:${key}:receipt:1`, documentId: `deposit:${key}`, documentNumber: `DP-${index}`, sourceType: 'deposit_stock', amount: 250, orderAmount: 250, handlingFee: 0, carrierCode: null })
    }
    const prepaid = orders.find(o => o.id.endsWith(':prepaid-fulfillment'))
    if (prepaid) {
      const current = businessDate(prepaid.paidAt!), previous = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 2, 15, 1)).toISOString()
      const base = rows.find(r => r.documentId === prepaid.id)!
      base.amount = 60; base.orderAmount = 60; base.handlingFee = 0
      rows.push({ ...base, id: `${prepaid.id}:stock-receipt`, sourceType: 'full_payment_stock', documentId: `${prepaid.id}:stock`, documentNumber: 'ST-PREPAID-1000', paidAt: previous, amount: 1000, orderAmount: 1000, handlingFee: 0, carrierCode: null })
    }
    return rows
  }
  async getAnalytics(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, range: { from: string; to: string }): Promise<FopAnalytics> {
    this.assertIdentity(identity, permission)
    const registrations: FopAnalytics['registrations'] = []
    const registrationEntries: NonNullable<FopAnalytics['registrationEntries']> = []
    const start = Date.parse(`${range.from}T00:00:00Z`), end = Date.parse(`${range.to}T00:00:00Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 365 * DAY) throw new Error('Invalid demo analytics range')
    if (permission.analyticsScopes?.includes('registrations')) {
      const workspace = await this.organizations.getWorkspace(identity.userId)
      const employees = workspace.employees.filter(owner => owner.workbenchRoles.includes('sales')).map(owner => ({ owner, department: salesDepartmentFor(workspace, owner.departmentId) })).filter(item => item.department)
      // One authorized ledger drives totals, departments and salesperson series.
      for (let at = start; at <= end; at += DAY) {
        const date = new Date(at).toISOString().slice(0, 10)
        let total = 0
        for (const { owner, department } of employees) {
          const seed = createHash('sha256').update(`${identity.tenantId}:registration:${owner.id}:${date}`).digest().readUInt32BE(0)
          const count = seed % 18
          total += count
          registrationEntries.push({ departmentPathIds: departmentPath(workspace, owner.departmentId), date, salesDepartmentCode: department!, owner: { id: owner.id, name: owner.name }, count })
        }
        registrations.push({ date, count: total })
      }
    }
    return { subject: { ...identity }, registrations, registrationEntries, rates: permission.analyticsScopes?.includes('rates') ? [{ currency: 'USD', cnyPerUnit: 7.12 }, { currency: 'EUR', cnyPerUnit: 7.78 }, { currency: 'GBP', cnyPerUnit: 9.24 }] : [] }
  }
  private async orders(identity: Readonly<FopIdentity>): Promise<FopOrderCandidate[]> {
    const workspace = await this.organizations.getWorkspace(identity.userId)
    // Customers belong to salespeople. Collaboration roles process those orders through their business scope.
    const employees = workspace.employees.filter(employee => employee.workbenchRoles.includes('sales'))
      .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id))
    if (!employees.length) return []
    const nodes = new Map(workspace.nodes.map(node => [node.id, node]))
    const accountKey = createHash('sha256').update(identity.tenantId).digest('hex').slice(0, 12)
    const today = Date.parse(businessDate(new Date()) + 'T00:00:00Z')
    const year = new Date(today).getUTCFullYear()
    const orders: FopOrderCandidate[] = []
    const make = (index: number, createdAt: number, completed: boolean, stage = index % 6, awaitingPayment = false) => {
      const owner = employees[index % employees.length]
      const department = nodes.get(owner.departmentId)
      if (!department) return
      const salesDepartmentCode = owner.workbenchRoles.includes('sales') ? salesDepartmentFor(workspace, owner.departmentId) : undefined
      let organization = department
      const seen = new Set<string>()
      while (organization.kind !== 'organization' && organization.parentId && !seen.has(organization.id)) {
        seen.add(organization.id)
        const parent = nodes.get(organization.parentId)
        if (!parent) break
        organization = parent
      }
      if (organization.kind !== 'organization') return
      const customerIndex = Math.floor(index / employees.length) % CUSTOMERS.length
      const quantity = index % 3 + 1
      const paid = !awaitingPayment && (completed || stage !== 0 || index % 4 !== 0)
      const shipping = completed || stage === 4
      const allocated = completed || stage === 3 || stage === 4
      const suffix = String(index + 1).padStart(5, '0')
      // Independent of payment/stage: every queue includes single-, two- and three-product orders.
      const productCount = index % 5 === 0 ? 3 : index % 3 === 0 ? 2 : 1
      const selectedProducts = [0, 3, 5].slice(0, productCount).map(offset => PRODUCTS[(index + offset) % PRODUCTS.length])
      const items = selectedProducts.map((product, line) => ({ productId: `${accountKey}:product:${PRODUCTS.indexOf(product) + 1}`, sku: product.sku, name: product.name, imageUrl: imageUrl(product), variant: product.variant, quantity: line === 0 ? quantity : line }))
      const cents = selectedProducts.reduce((sum, product, line) => sum + product.cents * items[line].quantity, 0)
      const carrierSeed = createHash('sha256').update(`${accountKey}:carrier:${index}:${createdAt}`).digest().readUInt32BE(0) % 100
      const carrier = FOP_CARRIERS[CARRIER_THRESHOLDS.findIndex(limit => carrierSeed < limit)]
      const purchaseExamples: ProcurementProgress[] = [
        { purchaseOrder: 'not_ordered', supplierPayment: 'not_required' },
        { purchaseOrder: 'partial', supplierPayment: 'paid' },
        { purchaseOrder: 'ordered', supplierPayment: 'unpaid' },
        { purchaseOrder: 'ordered', supplierPayment: 'partial' },
        { purchaseOrder: 'ordered', supplierPayment: 'paid' },
        { purchaseOrder: 'ordered', supplierPayment: 'paid' },
        { purchaseOrder: 'ordered', supplierPayment: 'refunded' },
        { purchaseOrder: 'unknown', supplierPayment: 'unknown' },
      ]
      const procurementProgress: ProcurementProgress = completed || stage >= 2 && stage <= 4
        ? { purchaseOrder: 'ordered', supplierPayment: 'paid' }
        : stage === 0 ? { purchaseOrder: 'unknown', supplierPayment: 'unknown' } : purchaseExamples[index % purchaseExamples.length]
      // Separate document lifecycle; an approved dispatch may still await Shopify synchronization.
      const dispatchDocuments: DispatchDocument[] = completed || stage === 4
        ? [{ id: `${accountKey}:dispatch:${suffix}:1`, number: `FY-${suffix}-1`, status: 'approved' }]
        : stage === 2 || stage === 3 ? [{ id: `${accountKey}:dispatch:${suffix}:1`, number: `FY-${suffix}-1`, status: (['draft', 'submitted', 'approved'] as const)[index % 3] }]
          : []
      if (stage === 3 && index % 4 === 0) dispatchDocuments.push({ id: `${accountKey}:dispatch:${suffix}:2`, number: `FY-${suffix}-2`, status: 'approved' })
      const shopifySync = completed ? 'synced' : stage === 0 ? paid ? 'pending' : 'not_required' : stage === 4 && index % 3 === 0 ? 'synced' : index % 5 === 0 ? 'partial' : 'pending'
      // A partially synchronized order must already have an approved dispatched package.
      if (shopifySync === 'partial' && !dispatchDocuments.some(document => document.status === 'approved')) {
        const documentIndex = dispatchDocuments.length + 1
        dispatchDocuments.push({ id: `${accountKey}:dispatch:${suffix}:${documentIndex}`, number: `FY-${suffix}-${documentIndex}`, status: 'approved' })
      }
      orders.push({
        dispatchDocuments,
        procurementProgress,
        tenantId: identity.tenantId, id: `${accountKey}:order:${suffix}`, orderNumber: `AF-${accountKey.slice(0, 4).toUpperCase()}-${suffix}`,
        shopifyOrderNumber: `#${10400 + index}`, customerId: `${accountKey}:customer:${owner.id}:${customerIndex + 1}`, customerCode: `${owner.code}-C${String(customerIndex + 1).padStart(3, '0')}`, customerName: `${CUSTOMERS[customerIndex]} (${owner.name})`, storeName: STORES[index % STORES.length], items,
        ...(salesDepartmentCode ? { salesDepartmentCode } : {}),
        currentCustomerOwner: { id: owner.id, departmentId: owner.departmentId, departmentPathIds: departmentPath(workspace, owner.departmentId) }, departmentPathIds: departmentPath(workspace, owner.departmentId), organization: { id: organization.id, name: organization.name }, department: { id: department.id, name: department.name }, owner: { id: owner.id, name: owner.name },
        amount: cents / 100, currency: 'USD', paymentStatus: paid ? 'paid' : 'unpaid', reviewStatus: completed || stage !== 0 ? 'approved' : 'pending',
        fulfillmentProgress: {
          allocationCreated: completed || stage !== 0,
          shopifySync,
          supplierShipment: completed || stage >= 2 && stage <= 4 ? 'shipped' : stage === 0 ? 'unknown' : index % 8 === 5 ? 'partial' : 'pending',
          stockReadiness: completed || allocated || stage === 2 && Math.floor(index / employees.length) % 2 === 0 ? 'ready' : stage === 0 ? 'unknown' : 'incomplete',
          allocationReview: completed || allocated ? 'approved' : 'pending',
          outbound: completed ? 'completed' : stage === 4 && index % 4 === 0 ? 'partial' : 'pending',
        },
        procurementStatus: completed || stage >= 2 ? 'purchased' : 'pending', allocationStatus: allocated ? 'allocated' : stage === 2 ? 'pending' : 'not_ready',
        dispatchStatus: shipping ? 'dispatched' : stage === 3 ? 'pending' : 'not_ready', shippingStatus: completed ? 'shipped' : stage === 4 ? 'pending' : 'not_ready',
        warehouseCode: (index + Math.floor(index / 12)) % 3 === 0 ? 'SZ' : 'HZ', warehouse: (index + Math.floor(index / 12)) % 3 === 0 ? '深圳仓' : '杭州仓', carrierCode: carrier.id, carrier: carrier.label,
        trackingNumber: shipping ? `HZ${accountKey.slice(0, 5).toUpperCase()}${String(800000000 + index)}` : null,
        salesperson: owner.name, createdAt: new Date(createdAt).toISOString(), paidAt: paid ? new Date(createdAt + 15 * 60_000).toISOString() : null,
        cancelled: false, exception: !completed && stage === 5 ? { reason: (['stock', 'address', 'tracking'] as const)[Math.floor(index / 6) % 3], hours: 3 + index % 47 } : null,
      })
    }
    // Varied queue backlogs with independent customer, date and warehouse distributions.
    let index = 0
    for (const [stage, count] of [18, 27, 36, 24, 42, 13].entries()) {
      for (let n = 0; n < count; n++, index++) make(index, today - (1 + (index * 7 + Math.floor(index / 12)) % 21) * DAY + (8 + index % 8) * 3_600_000, false, stage)
    }
    // Unpaid examples cover every employee rotation; never enter paid fulfillment queues.
    for (let n = 0; n < 24; n++, index++) make(index, today - (1 + n % 14) * DAY + 8 * 3_600_000, false, 0, true)
    // Completed, paid orders populate monthly collections for this and the two prior years.
    for (let y = year - 2; y <= year; y++) for (let month = 0; month < 12; month++) for (let n = 0; n < 18; n++) {
      const at = Date.UTC(y, month, 2 + n, 9)
      if (at > today) continue
      make(216 + (y - (year - 2)) * 216 + month * 18 + n, at, true)
    }
    const source = orders.find(o => o.salesDepartmentCode && o.reviewStatus === 'approved' && o.paymentStatus === 'paid')
    if (source) orders.push({ ...source, id: `${source.id}:prepaid-fulfillment`, orderNumber: 'AF-PREPAID-0060', amount: 60,
      createdAt: new Date(today - DAY).toISOString(), paidAt: new Date(today - DAY + 3_600_000).toISOString(),
      customerId: `${accountKey}:prepaid-customer`, customerCode: 'PRE001', customerName: 'Prepaid Demo Customer', exception: null })
    for (const order of orders) {
      if (this.approved.has(this.documentKey(identity.tenantId, 'hzkj_orders', order.id))) {
        order.reviewStatus = 'approved'
        if (!order.fulfillmentProgress.allocationCreated) {
          // Demo completes the post-audit build immediately; production must read
          // the actual asynchronous allocation result, never infer it from review.
          order.fulfillmentProgress.allocationCreated = true
          order.fulfillmentProgress.stockReadiness = 'incomplete'
          order.fulfillmentProgress.allocationReview = 'pending'
        }
      }
      if (this.allocationIds(order).every(id => this.approved.has(this.documentKey(identity.tenantId, 'hzkj_alloc_bill', id)))) order.fulfillmentProgress.allocationReview = 'approved'
    }
    return orders
  }
}
