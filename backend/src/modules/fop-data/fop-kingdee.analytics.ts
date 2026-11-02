import Decimal from 'decimal.js'
import { businessDate } from './fop-business-time'
import { publicFreight } from './fop-freight'
import { publicReceipt } from './fop-receipts'
import { matchesBusinessScope, type BusinessScope } from '../users/business-scope'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'
import { FopIntegrationUnavailableError, FopPermissionDeniedError, type FopAnalyticsData, type FopAnalyticsResource, type FopIdentity, type FopOrderCandidate, type FopReceiptCandidate, type FopOrderItem, type SalesDepartmentCode } from './fop-data.types'

type Json = Record<string, unknown>
type Ref = { id: string; name: string; number?: string }
export function analyticsObject(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid analytics object')
  return value as Json
}
function text(value: unknown, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 2000) throw new Error('Invalid analytics text')
  return value
}
export function analyticsId(value: unknown): string {
  const id = text(value)
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new Error('Invalid analytics ID')
  return id
}
function ref(value: unknown): Ref {
  const row = analyticsObject(value)
  return { id: analyticsId(row.id), name: text(row.name, true), ...(row.number !== undefined ? { number: text(row.number, true) } : {}) }
}
function decimal(value: unknown): number {
  if (typeof value !== 'string' || value.length > 60 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid analytics decimal')
  const number = new Decimal(value).toNumber()
  if (!Number.isFinite(number)) throw new Error('Invalid analytics decimal')
  return number
}
function date(value: unknown): string {
  const result = text(value)
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid analytics date')
  return result
}
function lines(value: unknown): FopOrderItem[] {
  if (!Array.isArray(value)) throw new Error('Invalid analytics lines')
  return value.map(item => {
    const row = analyticsObject(item)
    return { sku: text(row.sku, true), name: text(row.name, true), variant: text(row.variant, true), quantity: decimal(row.quantity), imageUrl: null }
  })
}

/** 明确映射稳定ID，禁止按名称猜部门、仓库或物流商，避免把缺失映射当作“其他”悄悄统计。 */
export class KingdeeAnalyticsDecoder {
  private readonly departments: Record<string, SalesDepartmentCode>
  private readonly warehouses: Record<string, 'HZ' | 'SZ'>
  private readonly carriers: Record<string, 'YT' | '4PX' | 'WB' | 'YW' | 'JS' | 'OTHER'>
  constructor(config: { get(key: string): string | undefined }) {
    this.departments = this.mapping(config.get('FOP_KINGDEE_DEPARTMENT_MAP'), ['sales1', 'sales2', 'sales3', 'sales4'])
    this.warehouses = this.mapping(config.get('FOP_KINGDEE_WAREHOUSE_MAP'), ['HZ', 'SZ'])
    this.carriers = this.mapping(config.get('FOP_KINGDEE_CARRIER_MAP'), ['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER'])
  }
  private mapping<T extends string>(value: string | undefined, allowed: readonly T[]): Record<string, T> {
    if (!value?.trim()) return {}
    const source = analyticsObject(JSON.parse(value) as unknown), result: Record<string, T> = {}
    for (const [id, code] of Object.entries(source)) {
      if (!/^[1-9]\d{0,18}$/.test(id) || typeof code !== 'string' || !allowed.includes(code as T)) throw new FopIntegrationUnavailableError('fop_mapping_required')
      result[id] = code as T
    }
    return result
  }
  private mapped<T extends string>(mapping: Record<string, T>, id: string): T {
    if (!Object.prototype.hasOwnProperty.call(mapping, id)) throw new FopIntegrationUnavailableError('fop_mapping_required')
    return mapping[id]
  }

  /** 只按白名单构造事实；组织、本人/部门范围在上游之后再次复核。 */
  append(target: FopAnalyticsData, resource: FopAnalyticsResource, value: unknown, identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>, organizations: readonly string[]): string {
    const row = analyticsObject(value), organization = ref(row.organization), department = ref(row.department), owner = ref(row.owner)
    const departmentPathIds = kingdeeDepartmentPath(row.departmentPathIds, organization.id, department.id)
    if (!organizations.includes(organization.id) || !matchesBusinessScope(scope, { department, owner, departmentPathIds })) throw new FopPermissionDeniedError('Analytics row outside authorized scope')
    // 子部门使用可信祖先链中最近的已配置业务部门，不按部门名称或编号猜测归属。
    const mappedDepartment = [department.id, ...(departmentPathIds ?? []).slice().reverse()].find(id => Object.prototype.hasOwnProperty.call(this.departments, id))
    const salesDepartmentCode = this.mapped(this.departments, mappedDepartment ?? department.id)
    if (resource === 'registrations') {
      const id = analyticsId(row.id), registeredAt = date(row.registeredAt)
      target.registrations.push({ id, registeredAt, organization, department, departmentPathIds, owner, salesDepartmentCode })
      return id
    }
    const customer = ref(row.customer), warehouse = ref(row.warehouse), warehouseCode = this.mapped(this.warehouses, warehouse.id)
    const common = { tenantId: identity.tenantId, organization, department, departmentPathIds, owner, salesDepartmentCode, customerId: customer.id, customerCode: customer.number ?? '', customerName: customer.name, warehouse: warehouse.name, warehouseCode }
    if (resource === 'orders') {
      const carrier = ref(row.carrier), currency = text(row.currency)
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid order currency')
      const result: FopOrderCandidate = { ...common, id: analyticsId(row.id), orderNumber: text(row.orderNumber), shopifyOrderNumber: text(row.shopifyOrderNumber, true),
        fulfillmentProgress: { allocationCreated: null, shopifySync: 'unknown', supplierShipment: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', outbound: 'unknown' },
        storeName: text(row.storeName, true), carrierCode: this.mapped(this.carriers, carrier.id), carrier: carrier.name, trackingNumber: null,
        items: lines(row.items), amount: decimal(row.amount), currency, createdAt: date(row.createdAt), paidAt: date(row.paidAt),
        paymentStatus: 'paid', reviewStatus: 'approved', procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: 'unknown',
        salesperson: owner.name, cancelled: false, exception: null }
      target.orders.push(result)
      return result.id
    }
    if (resource === 'receipts') {
      const sourceType = row.sourceType
      if (sourceType !== 'fulfillment' && sourceType !== 'full_payment_stock') throw new Error('Invalid receipt source')
      const carrier = sourceType === 'fulfillment' ? ref(row.carrier) : null
      const id = text(row.id)
      if (!/^[1-9]\d{0,18}:[1-9]\d{0,18}$/.test(id)) throw new Error('Invalid receipt-line ID')
      const result: FopReceiptCandidate = { ...common, id, sourceType, documentId: analyticsId(row.documentId), documentNumber: text(row.documentNumber),
        carrierCode: carrier ? this.mapped(this.carriers, carrier.id) : null, amount: decimal(row.amount), orderAmount: decimal(row.orderAmount), handlingFee: decimal(row.handlingFee),
        currency: text(row.currency), paidAt: date(row.paidAt), reviewStatus: 'approved' as const, receiptReviewStatus: 'approved' as const, paymentStatus: 'paid' as const,
        cancelled: false, items: lines(row.items) }
      target.receipts.push({ tenantId: identity.tenantId, ...publicReceipt(result), departmentPathIds })
      return id
    }
    const carrier = ref(row.carrier), id = analyticsId(row.id)
    const result = publicFreight({ ...common, id, documentNumber: text(row.documentNumber), orderNumber: text(row.orderNumber), trackingNumber: row.trackingNumber ? text(row.trackingNumber) : null,
      carrierCode: this.mapped(this.carriers, carrier.id), carrierName: carrier.name, channelName: text(row.channelName, true),
      originalAmount: decimal(row.originalAmount), originalCurrency: text(row.originalCurrency), fxRateToUsd: decimal(row.fxRateToUsd), fxRateDate: text(row.fxRateDate), fxRateSource: text(row.fxRateSource),
      amount: decimal(row.amount), currency: 'USD', confirmedAt: date(row.confirmedAt), reviewStatus: 'approved', costStatus: 'confirmed' })
    if (result.fxRateDate !== businessDate(result.confirmedAt!)) throw new Error('Freight FX date mismatch')
    target.freight.push({ tenantId: identity.tenantId, ...result, departmentPathIds })
    return id
  }
}

export const emptyAnalyticsData = (): FopAnalyticsData => ({ orders: [], receipts: [], freight: [], registrations: [] })
