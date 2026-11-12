import { FopIdentity, FopIntegrationUnavailableError, FopPermissionDeniedError } from './fop-data.types'
import type { FopRealtimeApprovalContext, FopRealtimePage, FopRealtimeScope, CurrentInventoryRow, ReservedInventoryRow } from './fop-realtime.types'
import { approvalEntity, ApprovalCommand, ApprovalOutcome, ApprovalQueue } from './fop-approval.types'
import type { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import type { StockInventoryQuery, FopStockInventoryCandidate } from './fop-stock.types'
import { safeWangwangUrl } from './supplier-follow-up'
import type { FopSupplierContext, FopSupplierContact, FopSupplierContacts, FopSupplierLaunch, FopSupplierLaunchQuery } from './fop-realtime.types'
import { publicStockInventory } from './fop-stock'

type Row = Record<string, unknown>
const obj = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid realtime API response'); return v as Row }
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.trim() || v.length > 2000) throw new Error('Invalid realtime API text'); return v }
const quantity = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) throw new Error('Invalid realtime inventory quantity'); return v }
const count = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 0) throw new Error('Invalid realtime count'); return Number(v) }
const recent = (v: unknown): string => { const s = text(v), t = Date.parse(s); if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(t) || Date.now() - t > 60_000 || t - Date.now() > 5000) throw new Error('Realtime proof expired'); return s }
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => same(value, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.keys(a).sort(), right = Object.keys(b).sort()
  return same(left, right) && left.every(key => same((a as Row)[key], (b as Row)[key]))
}

/** Only explicitly published dedicated APIs are accepted. The historical inventory controller is a demo stub. */
export class KingdeeRealtimeAdapter {
  constructor(private readonly config: { get(key: string): string | undefined }, private readonly organizations: readonly string[],
    private readonly transport: (key: string, body: unknown, mutate?: boolean) => Promise<unknown>) {}

  private async read(key: string, code: 'fop_supplier_contacts_not_configured' | 'fop_approval_not_configured' | 'fop_current_inventory_not_configured' | 'fop_reserved_inventory_not_configured', identity: Readonly<FopIdentity>, currentScope: FopRealtimeScope, resource: string, query: unknown, mutate = false): Promise<Row> {
    if (this.config.get('FOP_QUERIES_PAUSED')?.trim().toLowerCase() === 'true') throw new FopIntegrationUnavailableError('fop_queries_paused')
    if (!this.config.get(key)?.trim()) throw new FopIntegrationUnavailableError(code)
    const response = await this.transport(key, { schemaVersion: 1, subject: identity, currentScope, resource, query }, mutate)
    try {
      const raw = obj(response), subject = obj(raw.subject), grant = obj(raw.authorization)
      if (raw.schemaVersion !== 1 || subject.tenantId !== identity.tenantId || subject.userId !== identity.userId || raw.resource !== resource
        || !same(raw.currentScope, currentScope) || grant.resource !== resource || grant.allowed !== true
        || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length || new Set(raw.organizationIds).size !== raw.organizationIds.length
        || raw.organizationIds.some(id => typeof id !== 'string' || !this.organizations.includes(id))) throw new FopPermissionDeniedError('Realtime resource or local scope not authorized')
      recent(grant.checkedAt)
      return obj(raw.result)
    } catch (error) {
      // The operation may already have committed. A malformed or mismatched receipt cannot prove rejection.
      if (mutate) throw Object.assign(new Error('Audit operation response is unconfirmed'), { cause: error })
      throw error
    }
  }

  async approval(identity: Readonly<FopIdentity>, currentScope: FopRealtimeScope, queue: ApprovalQueue, orderId: string): Promise<FopRealtimeApprovalContext> {
    const result = await this.read('FOP_KINGDEE_APPROVAL_CONTEXT_URL', 'fop_approval_not_configured', identity, currentScope, 'approval_context', { queue, orderId })
    const order = obj(result.order)
    if (order.id !== orderId || typeof result.inQueue !== 'boolean' || result.action !== queue || result.actionAllowed !== true || !Array.isArray(result.targets) || result.targets.length !== 1) throw new FopPermissionDeniedError('Approval action not authorized')
    const targets = result.targets.map(value => {
      const row = obj(value)
      if (row.tenantId !== identity.tenantId || row.orderId !== orderId || row.entity !== approvalEntity(queue) || !['A', 'B', 'C'].includes(String(row.status)) || typeof row.eligible !== 'boolean' || row.reason !== null && typeof row.reason !== 'string') throw new Error('Invalid realtime approval target')
      return { tenantId: identity.tenantId, orderId, entity: approvalEntity(queue), id: text(row.id), number: text(row.number), version: text(row.version), status: row.status as 'A' | 'B' | 'C', eligible: row.eligible, reason: row.reason as string | null }
    })
    const allocation = order.allocationDocument == null ? null : obj(order.allocationDocument)
    if (order.dispatchDocuments !== null && !Array.isArray(order.dispatchDocuments)) throw new Error('Missing current dispatch facts')
    const documents = order.dispatchDocuments === null ? null : (order.dispatchDocuments as unknown[]).map(value => { const row = obj(value); if (!['draft', 'submitted', 'approved', 'unknown'].includes(String(row.status))) throw new Error('Invalid dispatch fact'); return { id: text(row.id), number: text(row.number), status: row.status as 'draft' | 'submitted' | 'approved' | 'unknown' } })
    return { identity: { ...identity }, currentScope, inQueue: result.inQueue,
      order: { id: orderId, orderNumber: text(order.orderNumber), allocationDocument: allocation ? { id: text(allocation.id), number: text(allocation.number) } : null, dispatchDocuments: documents }, targets }
  }

  async approve(identity: Readonly<FopIdentity>, command: ApprovalCommand): Promise<ApprovalOutcome> {
    if (!command.currentScope || command.currentScope.actorAccountId !== command.actorAccountId || command.tenantId !== identity.tenantId
      || command.operation !== 'audit' || !['hzkj_orders', 'hzkj_alloc_bill'].includes(command.entity) || !/^[a-f0-9]{64}$/.test(command.idempotencyKey)
      || command.status !== 'B' || command.eligible !== true) throw new FopPermissionDeniedError('Missing current operation scope')
    const result = await this.read('FOP_KINGDEE_OPERATION_URL', 'fop_approval_not_configured', identity, command.currentScope, 'approval_operation', command, true)
    if (result.atomicChecks !== true || result.idempotencyKey !== command.idempotencyKey || result.requestId !== command.requestId || result.documentId !== command.id
      || !['approved', 'already_approved', 'blocked', 'failed', 'unknown'].includes(String(result.status)) || typeof result.message !== 'string' || result.warning !== null && typeof result.warning !== 'string') throw new Error('Unconfirmed operation result')
    return { status: result.status as ApprovalOutcome['status'], message: result.message.slice(0, 1000), warning: (result.warning as string | null)?.slice(0, 1000) ?? null }
  }

  private selection(result: Row, ids: readonly string[] | undefined, includeWarehouse = true): Set<string> | undefined {
    if (!ids) return undefined
    if (!Array.isArray(result.selectedOrders) || result.selectedOrders.length !== ids.length) throw new FopPermissionDeniedError('Selected orders could not be revalidated')
    const seen = new Set<string>(), pairs = new Set<string>()
    for (const value of result.selectedOrders) {
      const row = obj(value), id = text(row.id), customer = text(row.customerId), warehouse = text(row.warehouseCode)
      if (!ids.includes(id) || seen.has(id) || row.eligible !== true || !Array.isArray(row.skus) || !row.skus.length) throw new FopPermissionDeniedError('Selected orders changed')
      seen.add(id)
      for (const sku of row.skus) pairs.add(JSON.stringify(includeWarehouse ? [customer, text(sku), warehouse] : [customer, text(sku)]))
    }
    return pairs
  }

  private page(result: Row, query: { page: number; pageSize: number }) {
    const total = count(result.total)
    if (result.complete !== true || !Array.isArray(result.items) || result.items.length > query.pageSize || result.page !== query.page || result.pageSize !== query.pageSize
      || result.items.length !== Math.min(query.pageSize, Math.max(0, total - (query.page - 1) * query.pageSize))) throw new Error('Incomplete realtime page')
    return { total, page: query.page, pageSize: query.pageSize, asOf: recent(result.asOf), source: 'fop' as const }
  }

  async current(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: AllocationInventoryQueryDto): Promise<FopRealtimePage<CurrentInventoryRow>> {
    const result = await this.read('FOP_KINGDEE_CURRENT_INVENTORY_URL', 'fop_current_inventory_not_configured', identity, scope, 'current_inventory', query)
    const page = this.page(result, query), pairs = this.selection(result, query.mode === 'selected' ? query.orderIds : undefined), seen = new Set<string>()
    const items = (result.items as unknown[]).map(value => {
      const row = obj(value), id = text(row.id), sku = text(row.sku), warehouseCode = text(row.warehouseCode), customer = row.customer === null ? null : obj(row.customer)
      const customerId = customer ? text(customer.id) : null, key = JSON.stringify([customerId, sku, warehouseCode])
      if (seen.has(key) || !['HZ', 'SZ'].includes(warehouseCode) || query.warehouseCode && query.warehouseCode !== warehouseCode
        || query.mode === 'search' && !sku.toLowerCase().includes(query.search!.trim().toLowerCase())
        || pairs && !(customerId ? pairs.has(key) : [...pairs].some(pair => { const p = JSON.parse(pair) as string[]; return p[1] === sku && p[2] === warehouseCode }))) throw new FopPermissionDeniedError('Inventory outside selected dimensions')
      seen.add(key)
      const onHand = quantity(row.onHand), occupied = quantity(row.occupied)
      return { id, sku, name: text(row.name), warehouseCode: warehouseCode as 'HZ' | 'SZ', warehouse: text(row.warehouse), customer: customer ? { id: customerId!, name: text(customer.name) } : null, onHand, occupied, free: Math.max(0, onHand - occupied) }
    })
    return { ...page, items }
  }

  async reserved(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: StockInventoryQuery): Promise<FopRealtimePage<ReservedInventoryRow>> {
    const result = await this.read('FOP_KINGDEE_RESERVED_INVENTORY_URL', 'fop_reserved_inventory_not_configured', identity, scope, 'reserved_inventory', query)
    const page = this.page(result, query), pairs = this.selection(result, query.orderIds, false), seen = new Set<string>()
    const actorEmployeeId = scope.actorEmployeeId ?? scope.business.employeeId
    if (!query.orderIds && !actorEmployeeId && page.total !== 0) throw new FopPermissionDeniedError('Current employee is required for unselected reserved inventory')
    const items = (result.items as unknown[]).map(value => {
      const row = obj(value) as unknown as FopStockInventoryCandidate
      const key = JSON.stringify([row.customerId, row.sku, row.warehouseCode])
      if (row.tenantId !== identity.tenantId || seen.has(key) || pairs && !pairs.has(JSON.stringify([row.customerId, row.sku]))
        || !query.orderIds && row.owner?.id !== actorEmployeeId
        || scope.employeeFilter.employeeIds !== null && !scope.employeeFilter.employeeIds.includes(row.owner?.id)
        || query.customerId && row.customerId !== query.customerId || query.warehouseCode && row.warehouseCode !== query.warehouseCode
        || query.search?.trim() && ![row.sku, row.name].some(v => v?.toLowerCase().includes(query.search!.trim().toLowerCase()))
        || query.customerSearch?.trim() && ![row.customerCode, row.customerName].some(v => v?.toLowerCase().includes(query.customerSearch!.trim().toLowerCase()))) throw new FopPermissionDeniedError('Reserved inventory outside current scope')
      seen.add(key)
      // Full-payment and deposit balances remain independent. Neither is reconstructed from physical stock.
      return publicStockInventory(row)
    })
    return { ...page, items, customerId: query.customerId ?? null, refreshedAt: page.asOf }
  }

  private supplierContext(query: FopSupplierContext) {
    const resource = { fulfillment: 'orders', stock: 'stock_orders', purchase_group: 'purchase_orders', purchase_return: 'purchase_returns' }[query.context]
    if (!resource) throw new FopPermissionDeniedError('Invalid supplier context')
    const orderId = query.context === 'purchase_group' ? text(query.groupId) : text(query.orderId)
    if ((query.context === 'fulfillment' || query.context === 'stock') && query.queue !== 'procurement_shipping'
      || query.context === 'purchase_group' && query.filters.queue !== 'procurement_shipping'
      || query.context === 'purchase_return' && !['procurement', 'warehouse'].includes(query.workbenchRole)) throw new FopPermissionDeniedError('Invalid supplier queue or role')
    if (query.context === 'purchase_return') {
      text(query.returnId)
      const entity = this.config.get('FOP_KINGDEE_PHYSICAL_RETURN_ENTITY')?.trim()
      // The refund application is not a physical return. No guessed entity or legacy fallback.
      if (!entity || !/^[a-z][a-z0-9_]{0,127}$/.test(entity) || entity === 'hzkj_purrefundapplybill') throw new FopIntegrationUnavailableError('fop_supplier_contacts_not_configured')
    }
    return { resource, orderId }
  }

  private supplierProof(result: Row, context: FopSupplierContext) {
    const { resource, orderId } = this.supplierContext(context), grant = obj(result.sourceAuthorization)
    if (!same(result.context, context) || result.source !== 'fop' || result.orderId !== orderId || result.relationshipVerified !== true
      || grant.resource !== resource || grant.allowed !== true
      || context.context === 'purchase_return' && result.sourceEntity !== this.config.get('FOP_KINGDEE_PHYSICAL_RETURN_ENTITY')?.trim()) throw new FopPermissionDeniedError('Supplier source relationship or independent read permission not confirmed')
    recent(grant.checkedAt)
    return orderId
  }

  async supplierContacts(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, context: FopSupplierContext): Promise<FopSupplierContacts> {
    context = JSON.parse(JSON.stringify(context)) as FopSupplierContext
    this.supplierContext(context)
    const result = await this.read('FOP_KINGDEE_SUPPLIER_CONTACTS_URL', 'fop_supplier_contacts_not_configured', identity, scope, 'supplier_contacts', context)
    const orderId = this.supplierProof(result, context), seen = new Set<string>()
    if (result.complete !== true || !Array.isArray(result.items) || result.items.length > 1000 || (context.context === 'purchase_group' || context.context === 'purchase_return') && result.items.length > 1) throw new Error('Invalid supplier contacts')
    const items: FopSupplierContact[] = result.items.map(value => {
      const row = obj(value), supplier = obj(row.supplier), purchaseOrderId = text(row.purchaseOrderId)
      if (seen.has(purchaseOrderId) || row.platformOrderNumber !== null && typeof row.platformOrderNumber !== 'string'
        || !['ready', 'missing_account', 'chat_unavailable'].includes(String(row.availability)) || !Array.isArray(row.lines)) throw new Error('Invalid supplier contact')
      seen.add(purchaseOrderId)
      const account = supplier.wangwangAccount === null ? null : text(supplier.wangwangAccount)
      if (account && (account.length > 128 || [...account].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
        || (row.availability === 'missing_account') !== (account === null)) throw new Error('Invalid supplier account availability')
      if (!/^[a-f0-9]{64}$/.test(String(row.contactVersion)) || context.context !== 'purchase_return' && (row.paid !== true || row.cancelled !== false || !['pending', 'partial'].includes(String(row.shipmentStatus)))) throw new Error('Supplier purchase is not eligible for follow-up')
      const allocated = context.context === 'fulfillment' || context.context === 'stock'
      if (allocated && (!['pending', 'partial'].includes(String(row.shipmentStatus)) || !row.lines.length)
        || !allocated && row.lines.length) throw new Error('Missing source-specific supplier allocation')
      const lineIds = new Set<string>()
      const lines = row.lines.map(value => {
        const line = obj(value), purchaseLineId = text(line.purchaseLineId)
        const sourceKey = context.context === 'stock' ? 'stockLineId' : 'fulfillmentLineId', sourceLineId = text(line[sourceKey])
        const key = JSON.stringify([sourceLineId, purchaseLineId]), pendingQuantity = quantity(line.pendingQuantity)
        if (lineIds.has(key) || !pendingQuantity) throw new Error('Invalid supplier source allocation')
        lineIds.add(key)
        return { [sourceKey]: sourceLineId, purchaseLineId, sku: text(line.sku), name: text(line.name), pendingQuantity }
      })
      return { purchaseOrderId, purchaseOrderNumber: text(row.purchaseOrderNumber), platformOrderNumber: row.platformOrderNumber as string | null,
        supplier: { id: text(supplier.id), name: text(supplier.name), wangwangAccount: account },
        ...(allocated ? { shipmentStatus: row.shipmentStatus as 'pending' | 'partial' } : {}), lines,
        availability: row.availability as FopSupplierContact['availability'], contactVersion: text(row.contactVersion) }
    })
    return { source: 'fop', orderId, orderNumber: text(result.orderNumber), refreshedAt: recent(result.refreshedAt), items }
  }

  async supplierChat(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: FopSupplierLaunchQuery): Promise<FopSupplierLaunch> {
    query = JSON.parse(JSON.stringify(query)) as FopSupplierLaunchQuery
    const { purchaseOrderId, contactVersion, ...context } = query
    text(purchaseOrderId); text(contactVersion); this.supplierContext(context)
    const result = await this.read('FOP_KINGDEE_SUPPLIER_CHAT_URL', 'fop_supplier_contacts_not_configured', identity, scope, 'supplier_chat', query)
    const orderId = this.supplierProof(result, context), account = text(result.wangwangAccount)
    if (result.mode !== 'live' || result.purchaseOrderId !== purchaseOrderId || result.contactVersion !== contactVersion) throw new FopPermissionDeniedError('Supplier contact changed')
    const url = safeWangwangUrl(result.url, account)
    if (result.url !== null && !url) throw new Error('Supplier launch URL is not allowed')
    return { source: 'fop', mode: 'live', orderId, purchaseOrderId, wangwangAccount: account, url }
  }

  async customers(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: { search?: string }) {
    const result = await this.read('FOP_KINGDEE_RESERVED_INVENTORY_URL', 'fop_reserved_inventory_not_configured', identity, scope, 'reserved_inventory', { ...query, projection: 'customers' })
    if (!Array.isArray(result.items) || count(result.total) < result.items.length) throw new Error('Invalid reserved customer result')
    if (Number(result.total) > 100 || Number(result.total) !== result.items.length) throw new FopIntegrationUnavailableError('fop_reserved_customers_search_required')
    if (result.complete !== true) throw new Error('Invalid reserved customer result')
    const ids = new Set<string>()
    const items = result.items.map(value => { const row = obj(value), id = text(row.id); if (ids.has(id)) throw new Error('Duplicate customer'); ids.add(id); return { id, code: typeof row.code === 'string' ? row.code : '', name: text(row.name) } })
    return { items, total: Number(result.total) }
  }
}
