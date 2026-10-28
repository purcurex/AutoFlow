import Decimal from 'decimal.js'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { SALES_DEPARTMENTS } from './fop-data.types'
import { FopStockOrderCandidate, FopStockInventoryCandidate, FopStockOrder, StockFilters, StockOwnership, STOCK_TYPES, STOCK_PURCHASE_STATUSES, StockBalance } from './fop-stock.types'

const string = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function ownership(row: StockOwnership) {
  if (!string(row.customerId) || !string(row.customerName) || typeof row.customerCode !== 'string' || !string(row.owner?.id) || !string(row.owner?.name) || !string(row.department?.id) || !string(row.department?.name)) throw new Error('Invalid stock ownership')
  if (row.departmentPathIds !== undefined && (!Array.isArray(row.departmentPathIds) || row.departmentPathIds.some(id => !string(id)))) throw new Error('Invalid stock ancestry')
  return { customerId: row.customerId, customerCode: row.customerCode, customerName: row.customerName, owner: { id: row.owner.id, name: row.owner.name }, department: { id: row.department.id, name: row.department.name } }
}
export function publicStockOrder(row: FopStockOrderCandidate): FopStockOrder {
  if (!string(row.id) || !string(row.stockNumber) || !STOCK_TYPES.includes(row.stockType) || !STOCK_PURCHASE_STATUSES.includes(row.purchaseStatus) || typeof row.cancelled !== 'boolean'
    || !Number.isFinite(row.amount) || row.amount < 0 || row.amount > Number.MAX_SAFE_INTEGER || !/^[A-Z]{3}$/.test(row.currency) || !['HZ', 'SZ'].includes(row.warehouseCode) || !string(row.warehouse)
    || row.storeName !== null && typeof row.storeName !== 'string' || !Array.isArray(row.items) || !row.items.length) throw new Error('Invalid stock order')
  if (row.paymentStatus !== undefined && !['paid', 'unpaid', 'unknown'].includes(row.paymentStatus) || row.reviewStatus !== undefined && !['approved', 'pending', 'unknown'].includes(row.reviewStatus)) throw new Error('Invalid stock payment/review status')
  const paidAt = normalizeBusinessTimestamp(row.paidAt)
  if (row.paidAt !== null && !paidAt) throw new Error('Invalid stock payment time')
  const items = row.items.map(item => {
    if (!string(item.sku) || !string(item.name) || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > Number.MAX_SAFE_INTEGER || typeof item.variant !== 'string' || item.imageUrl !== null && typeof item.imageUrl !== 'string') throw new Error('Invalid stock product')
    return { sku: item.sku, name: item.name, imageUrl: item.imageUrl, variant: item.variant, quantity: item.quantity }
  })
  return { ...ownership(row), id: row.id, stockNumber: row.stockNumber, stockType: row.stockType, storeName: row.storeName, items, amount: row.amount, currency: row.currency, paidAt, paymentStatus: row.paymentStatus ?? 'unknown', reviewStatus: row.reviewStatus ?? 'unknown', purchaseStatus: row.purchaseStatus, warehouseCode: row.warehouseCode, warehouse: row.warehouse }
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
export function filterStockOrders(rows: FopStockOrderCandidate[], query: StockFilters): FopStockOrder[] {
  const search = query.search?.trim().toLowerCase()
  return rows.filter(row => !row.cancelled && (query.queue !== 'procurement' || row.paymentStatus === 'paid' && row.reviewStatus === 'approved' && ['unpurchased', 'partial'].includes(row.purchaseStatus)) && stockScopeMatches(row, query) && (!query.stockType || row.stockType === query.stockType) && (!query.purchaseStatus || row.purchaseStatus === query.purchaseStatus)
    && (!search || [row.stockNumber, row.customerCode, row.customerName, row.storeName ?? '', row.owner.name, ...row.items.flatMap(i => [i.sku, i.name])].some(v => v.toLowerCase().includes(search))))
    .map(publicStockOrder).sort((a, b) => {
      if (!a.paidAt || !b.paidAt) return a.paidAt ? -1 : b.paidAt ? 1 : a.id.localeCompare(b.id)
      return (Date.parse(a.paidAt) - Date.parse(b.paidAt)) * (query.sortOrder === 'desc' ? -1 : 1) || a.id.localeCompare(b.id)
    })
}
export function stockTotals(rows: FopStockOrder[]) {
  const sums = new Map<string, Decimal>()
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? new Decimal(0)).plus(row.amount))
  return { orderCount: rows.length, itemQuantity: rows.reduce((sum, row) => sum + row.items.reduce((n, i) => n + i.quantity, 0), 0), amounts: [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toNumber() })) }
}
