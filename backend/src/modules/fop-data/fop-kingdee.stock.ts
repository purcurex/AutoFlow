import Decimal from 'decimal.js'
import { matchesBusinessScope, type BusinessScope } from '../users/business-scope'
import { FopIntegrationUnavailableError, FopPermissionDeniedError, type FopIdentity, type SalesDepartmentCode } from './fop-data.types'
import { analyticsId as id, analyticsObject as object } from './fop-kingdee.analytics'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'
import { publicStockInventory, publicStockOrder } from './fop-stock'
import type { FopStockInventoryCandidate, FopStockOrderCandidate } from './fop-stock.types'

function text(value: unknown, empty = false): string {
  if (typeof value !== 'string' || !empty && !value.trim() || value.length > 2000) throw new Error('Invalid Kingdee stock text')
  return value
}
function reference(value: unknown) { const row = object(value); return { id: id(row.id), name: text(row.name) } }
function number(value: unknown): number {
  if (typeof value !== 'string' || value.length > 60 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid Kingdee stock decimal')
  const result = new Decimal(value)
  if (!result.isFinite() || result.greaterThan(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid Kingdee stock decimal')
  return result.toNumber()
}
function timestamp(value: unknown): string | null {
  if (value === null) return null
  const result = text(value)
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid Kingdee stock timestamp')
  return result
}
function image(value: unknown) { return value === null || value === '' ? null : text(value) }

/** 仅转换独立只读接口的白名单字段；每条复核租户、公司和本人/直属部门范围。 */
export class KingdeeStockDecoder {
  private readonly warehouses: Record<string, 'HZ' | 'SZ'>
  private readonly departments: Record<string, SalesDepartmentCode>
  constructor(config: { get(key: string): string | undefined }) {
    this.warehouses = this.warehouseMapping(config.get('FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP'))
    this.departments = this.mapping(config.get('FOP_KINGDEE_DEPARTMENT_MAP'), ['sales1', 'sales2', 'sales3', 'sales4'])
  }
  private mapping<T extends string>(value: string | undefined, allowed: T[]): Record<string, T> {
    const source = value?.trim() ? object(JSON.parse(value)) : {}
    if (Object.keys(source).length > 200 || Object.entries(source).some(([key, code]) => !/^[1-9]\d{0,18}$/.test(key) || !allowed.includes(code as T))) throw new FopIntegrationUnavailableError('fop_mapping_required')
    return source as Record<string, T>
  }
  /** 备货独立配置使用金蝶仓库编码；保留前导零和大小写，不改变待支付、分析使用的内码映射。 */
  private warehouseMapping(value: string | undefined): Record<string, 'HZ' | 'SZ'> {
    const source = value?.trim() ? object(JSON.parse(value)) : {}
    if (Object.keys(source).length > 200 || Object.entries(source).some(([key, code]) => !key.trim() || key.length > 2000 || !['HZ', 'SZ'].includes(code as string))) throw new FopIntegrationUnavailableError('fop_mapping_required')
    return source as Record<string, 'HZ' | 'SZ'>
  }
  private ownership(row: Record<string, unknown>, identity: FopIdentity, scope: BusinessScope, organizations: readonly string[], allowUnassignedOwner = false) {
    // 仅历史备货单允许缺业务员。“unassigned”是页面标记，不是金蝶人员ID；本人范围仍无法匹配该记录。
    const owner = allowUnassignedOwner && row.owner == null ? { id: 'unassigned', name: '未分配' } : reference(row.owner)
    const organization = reference(row.organization), department = reference(row.department), customer = reference(row.customer), warehouse = reference(row.warehouse)
    const departmentPathIds = kingdeeDepartmentPath(row.departmentPathIds, organization.id, department.id, true)
    if (!organizations.includes(organization.id) || !matchesBusinessScope(scope, { owner, department })) throw new FopPermissionDeniedError('Stock row outside authorized scope')
    // 编码与名称、内码严格区分；只匹配显式配置项，不自动猜名称或退回旧内码配置。
    const warehouseNumber = text(object(row.warehouse).number)
    const warehouseCode = Object.prototype.hasOwnProperty.call(this.warehouses, warehouseNumber) ? this.warehouses[warehouseNumber] : undefined
    if (!warehouseCode) throw new FopIntegrationUnavailableError('fop_mapping_required')
    return { tenantId: identity.tenantId, customerId: customer.id, customerCode: text(object(row.customer).number ?? '', true), customerName: customer.name,
      owner, department, departmentPathIds, salesDepartmentCode: this.departments[department.id], warehouseCode, warehouse: warehouse.name }
  }
  order(value: unknown, identity: FopIdentity, scope: BusinessScope, organizations: readonly string[]): FopStockOrderCandidate {
    const row = object(value)
    if (!['1', '2'].includes(String(row.stockType)) || !['1', '2'].includes(String(row.orderStatus)) || !['A', 'B', 'C', 'D', 'Z'].includes(String(row.billStatus)) || !Array.isArray(row.items)) throw new Error('Invalid Kingdee stock status')
    const purchaseStatuses = { '0': 'unpurchased', '1': 'partial', '2': 'purchased', '3': 'received', '4': 'shipped' } as const
    const result: FopStockOrderCandidate = { ...this.ownership(row, identity, scope, organizations, true), id: id(row.id), stockNumber: text(row.stockNumber),
      stockType: String(row.stockType) === '1' ? 'full_payment' : 'deposit', cancelled: false,
      paymentStatus: String(row.orderStatus) === '2' ? 'paid' : 'unpaid', reviewStatus: row.billStatus === 'C' ? 'approved' : 'pending',
      amount: number(row.amount), currency: text(row.currency), paidAt: timestamp(row.paidAt), createdAt: timestamp(row.createdAt),
      procurementPaidAt: timestamp(row.procurementPaidAt), storeName: row.storeName === null ? null : text(row.storeName, true),
      purchaseStatus: purchaseStatuses[String(row.purchaseStatus) as keyof typeof purchaseStatuses] ?? 'unknown',
      items: row.items.map(value => { const line = object(value); return { sku: text(line.sku), name: text(line.name), variant: text(line.variant ?? '', true), imageUrl: image(line.imageUrl), quantity: number(line.quantity) } }) }
    publicStockOrder(result)
    return result
  }
  inventory(value: unknown, identity: FopIdentity, scope: BusinessScope, organizations: readonly string[]): FopStockInventoryCandidate {
    const row = object(value), fullPayment = object(row.fullPayment), deposit = object(row.deposit)
    const result = { ...this.ownership(row, identity, scope, organizations), id: id(row.id), sku: text(row.sku), name: text(row.name), imageUrl: image(row.imageUrl),
      fullPayment: { available: number(fullPayment.available), locked: number(fullPayment.locked) }, deposit: { available: number(deposit.available), locked: number(deposit.locked) } }
    publicStockInventory(result)
    return result
  }
}
