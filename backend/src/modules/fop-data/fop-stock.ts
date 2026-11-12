import Decimal from 'decimal.js'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { consumerPaymentRange } from './consumer-payment-range'
import { SALES_DEPARTMENTS } from './fop-data.types'
import { FopStockOrderCandidate, FopStockInventoryCandidate, FopStockOrder, StockFilters, StockOwnership, STOCK_TYPES, STOCK_PURCHASE_STATUSES, StockBalance } from './fop-stock.types'

const string = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function stockOrderStatus(row: FopStockOrderCandidate): FopStockOrder['orderStatus'] {
  if (row.paymentStatus === 'unpaid' && row.reviewStatus !== 'approved') return 'unpaid'
  if (row.paymentStatus === 'paid' && row.reviewStatus === 'pending') return 'paid'
  if (row.paymentStatus === 'paid' && row.reviewStatus === 'approved') return 'approved'
  return null
}
function ownership(row: StockOwnership) {
  if (!string(row.customerId) || !string(row.customerName) || typeof row.customerCode !== 'string' || !string(row.owner?.id) || !string(row.owner?.name) || !string(row.department?.id) || !string(row.department?.name)) throw new Error('Invalid stock ownership')
  if (row.departmentPathIds !== undefined && (!Array.isArray(row.departmentPathIds) || row.departmentPathIds.some(id => !string(id)))) throw new Error('Invalid stock ancestry')
  return { customerId: row.customerId, customerCode: row.customerCode, customerName: row.customerName, owner: { id: row.owner.id, name: row.owner.name }, department: { id: row.department.id, name: row.department.name } }
}
export function publicStockOrder(row: FopStockOrderCandidate): FopStockOrder {
  // 历史空明细单保留真实表头；空数组不伪造商品，缺失数组及非法商品仍按原校验拦截。
  if (!string(row.id) || !string(row.stockNumber) || !STOCK_TYPES.includes(row.stockType) || !STOCK_PURCHASE_STATUSES.includes(row.purchaseStatus) || typeof row.cancelled !== 'boolean'
    || !Number.isFinite(row.amount) || row.amount < 0 || row.amount > Number.MAX_SAFE_INTEGER || !/^[A-Z]{3}$/.test(row.currency) || !['HZ', 'SZ'].includes(row.warehouseCode) || !string(row.warehouse)
    || row.storeName !== null && typeof row.storeName !== 'string' || !Array.isArray(row.items)) throw new Error('Invalid stock order')
  if (row.paymentStatus !== undefined && !['paid', 'unpaid', 'unknown'].includes(row.paymentStatus) || row.reviewStatus !== undefined && !['approved', 'pending', 'unknown'].includes(row.reviewStatus)) throw new Error('Invalid stock payment/review status')
  const paidAt = normalizeBusinessTimestamp(row.paidAt)
  if (row.paidAt !== null && !paidAt) throw new Error('Invalid stock payment time')
  const items = row.items.map(item => {
    if (!string(item.sku) || !string(item.name) || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > Number.MAX_SAFE_INTEGER || typeof item.variant !== 'string' || item.imageUrl !== null && typeof item.imageUrl !== 'string') throw new Error('Invalid stock product')
    return { sku: item.sku, name: item.name, imageUrl: item.imageUrl, variant: item.variant, quantity: item.quantity }
  })
  return { ...ownership(row), id: row.id, stockNumber: row.stockNumber, stockType: row.stockType, storeName: row.storeName, items, amount: row.amount, currency: row.currency, paidAt, createdAt: normalizeBusinessTimestamp(row.createdAt), paymentStatus: row.paymentStatus ?? 'unknown', reviewStatus: row.reviewStatus ?? 'unknown', orderStatus: stockOrderStatus(row), purchaseStatus: row.purchaseStatus, procurementPaidAt: normalizeBusinessTimestamp(row.procurementPaidAt), warehouseCode: row.warehouseCode, warehouse: row.warehouse }
}
function balance(value: StockBalance) {
  if (!value || [value.available, value.locked].some(qty => !Number.isFinite(qty) || qty < 0 || qty > Number.MAX_SAFE_INTEGER)) throw new Error('Invalid inventory quantity')
  const onHand = new Decimal(value.available).plus(value.locked).toNumber()
  if (onHand > Number.MAX_SAFE_INTEGER) throw new Error('Inventory quantity overflow')
  return { available: value.available, locked: value.locked, onHand }
}
export function publicStockInventory(row: FopStockInventoryCandidate) {
  if (!string(row.id) || !string(row.sku) || !string(row.name) || !['HZ', 'SZ'].includes(row.warehouseCode) || !string(row.warehouse) || row.imageUrl !== null && typeof row.imageUrl !== 'string') throw new Error('Invalid inventory row')
  const fullPayment = balance(row.fullPayment), deposit = balance(row.deposit)
  const onHand = new Decimal(fullPayment.onHand).plus(deposit.onHand).toNumber()
  if (onHand > Number.MAX_SAFE_INTEGER) throw new Error('Inventory quantity overflow')
  return { ...ownership(row), id: row.id, sku: row.sku, name: row.name, imageUrl: row.imageUrl, warehouseCode: row.warehouseCode, warehouse: row.warehouse, fullPayment, deposit, onHand }
}
export function stockScopeMatches(row: StockOwnership & { warehouseCode: string }, query: StockFilters) {
  return (!query.departmentId || row.department.id === query.departmentId || row.departmentPathIds?.includes(query.departmentId)) && (!query.ownerId || row.owner.id === query.ownerId) && (!query.warehouseCode || row.warehouseCode === query.warehouseCode)
}
export function stockDepartments(rows: StockOwnership[]) {
  const map = new Map<string, { id: string; name: string }>()
  for (const row of rows) if (row.salesDepartmentCode && SALES_DEPARTMENTS.some(d => d.id === row.salesDepartmentCode && d.name === row.department?.name)) map.set(row.department.id, row.department)
  return [...map.values()].map(d => ({ id: d.id, name: d.name })).sort((a, b) => SALES_DEPARTMENTS.findIndex(d => d.name === a.name) - SALES_DEPARTMENTS.findIndex(d => d.name === b.name))
}
export function filterStockOrders(rows: FopStockOrderCandidate[], query: StockFilters, now = Date.now()): FopStockOrder[] {
  const search = query.search?.trim().toLowerCase()
  const inPaymentRange = consumerPaymentRange(query.timeRange, now)
  return rows.filter(row => !row.cancelled && (query.queue !== 'procurement' || row.paymentStatus === 'paid' && row.reviewStatus === 'approved' && ['unpurchased', 'partial', 'in_progress', 'purchased'].includes(row.purchaseStatus)) && stockScopeMatches(row, query) && (!query.stockType || row.stockType === query.stockType) && (!query.purchaseStatus || row.purchaseStatus === query.purchaseStatus)
    && (!search || [row.stockNumber, row.customerCode, row.customerName, row.storeName ?? '', row.owner.name, ...row.items.flatMap(i => [i.sku, i.name])].some(v => v.toLowerCase().includes(search))))
    .map(publicStockOrder).filter(row => (!query.orderStatus || row.orderStatus === query.orderStatus) && inPaymentRange(row.paidAt)
      && (!query.lifecycle || (query.lifecycle === 'unpaid' ? row.orderStatus === 'unpaid'
        : query.lifecycle === 'pending_procurement' ? row.paymentStatus === 'paid' && ['unpurchased', 'partial', 'in_progress', 'purchased'].includes(row.purchaseStatus)
          : row.orderStatus === 'approved' && row.purchaseStatus === 'received'))).sort((a, b) => {
      const statusSort = query.sortBy === 'orderStatus' || query.sortBy === 'purchaseStatus'
      const direction = query.sortOrder === 'asc' || query.sortOrder === undefined && statusSort ? 1 : -1
      const field = query.sortBy ?? 'createdAt'
      if (field === 'orderStatus' || field === 'purchaseStatus') {
        const stages: readonly (string | null)[] = field === 'orderStatus'
          ? ['unpaid', 'paid', 'approved'] : ['unpurchased', 'partial', 'in_progress', 'purchased', 'shipped', 'received']
        const left = stages.indexOf(a[field]), right = stages.indexOf(b[field])
        // Unknown facts remain last in either direction, never a business stage.
        if (left < 0 || right < 0) {
          if (left !== right) return left < 0 ? 1 : -1
        } else if (left !== right) return (left - right) * direction
      }
      const leftTime = field === 'createdAt' ? a.createdAt : a.paidAt, rightTime = field === 'createdAt' ? b.createdAt : b.paidAt
      if (!leftTime || !rightTime) return leftTime ? -1 : rightTime ? 1 : a.id.localeCompare(b.id)
      return (Date.parse(leftTime) - Date.parse(rightTime)) * (statusSort ? 1 : direction) || a.id.localeCompare(b.id)
    })
}
export function stockTotals(rows: FopStockOrder[]) {
  const sums = new Map<string, Decimal>()
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? new Decimal(0)).plus(row.amount))
  // 真实备货允许小数数量，合计沿用金额的Decimal计算，避免0.1+0.2产生浮点尾差。
  const itemQuantity = rows.reduce((sum, row) => row.items.reduce((quantity, item) => quantity.plus(item.quantity), sum), new Decimal(0))
  if (itemQuantity.greaterThan(Number.MAX_SAFE_INTEGER)) throw new Error('Stock quantity total overflow')
  return { orderCount: rows.length, itemQuantity: itemQuantity.toNumber(), amounts: [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toNumber() })) }
}
