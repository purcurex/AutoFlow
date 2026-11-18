import type { AllocationInventoryPage, AllocationInventoryQuery, AllocationInventoryRow } from '@/api/allocation-inventory'
import type { StockInventory, StockInventoryPage, StockScope } from '@/api/fop-stock'

// UI-only fixtures. Never persisted, used for allocations, or enabled in production builds.
export const inventoryMockEnabled = () => import.meta.env.DEV && import.meta.env.VITE_INVENTORY_MOCK === 'true'
const products = [
  ['HZ510011-001', 'Q12蓝色 4G防水 外贸版'],
  ['HZ220026-008', '18*5cm均码【彩盒装】-黑色【单只装】3D气囊07款'],
  ['HZ10001G-001', 'F1双拉链加厚后排坐垫'],
  ['HZ48001N-010', '定制耳朵，爱心/28cm-灰色'],
  ['HZ230013-039', '2026公路绿色跑车盲盒'],
  ['HZ490009-001', '卡片定制咨询客服/按需定制'],
] as const
const customers = ['Northstar Living', 'Maple Studio', 'Bright Home']
const asOf = new Date().toISOString()
const stock: StockInventory[] = products.flatMap(([sku, name], i) => (['HZ', 'SZ'] as const).map((warehouseCode, w) => {
  const available = i === 5 ? 0 : 48 + i * 11 + w * 20, locked = i === 5 ? 0 : 12 + i
  const depositAvailable = i === 4 ? 0 : 20 + i * 3, depositLocked = i === 4 ? 0 : 5
  return { id: `inventory-demo-${i}-${w}`, sku, name, imageUrl: null, warehouseCode, warehouse: warehouseCode === 'HZ' ? 'HangZhou' : 'ShenZhen',
    customerId: `demo-c${i % 3}`, customerCode: `DEMO-C00${i % 3 + 1}`, customerName: customers[i % 3]!,
    owner: { id: 'demo-owner', name: 'Alex' }, department: { id: 'demo-sales', name: '业务一部' },
    fullPayment: { available, locked, onHand: available + locked },
    deposit: { available: depositAvailable, locked: depositLocked, onHand: depositAvailable + depositLocked },
    onHand: available + locked + depositAvailable + depositLocked }
}))
const pools: AllocationInventoryRow[] = stock.flatMap((row, i) => [
  { id: `${row.id}-public`, sku: row.sku, name: row.name, warehouseCode: row.warehouseCode as 'HZ' | 'SZ', warehouse: row.warehouse,
    customer: null, onHand: i % 5 === 0 ? 0 : 160 + i * 7, occupied: i % 5 === 0 ? 0 : 30, free: i % 5 === 0 ? 0 : 130 + i * 7 },
  { id: `${row.id}-customer`, sku: row.sku, name: row.name, warehouseCode: row.warehouseCode as 'HZ' | 'SZ', warehouse: row.warehouse,
    customer: { id: row.customerId, name: row.customerName }, onHand: row.onHand!, occupied: row.fullPayment.locked! + row.deposit.locked!,
    free: row.fullPayment.available! + row.deposit.available! },
])
const matches = (value: string, search?: string) => !search?.trim() || value.toLowerCase().includes(search.trim().toLowerCase())
function paginate<T>(rows: T[], page: number, pageSize: number) { return rows.slice((page - 1) * pageSize, page * pageSize) }
// Selected IDs define a stable demo scenario; they do not represent live inventory rights.
function scenario(ids?: string[]) { return ids?.length ? new Set(ids.flatMap((_, i) => [products[i % products.length]![0], products[(i + 1) % products.length]![0]])) : null }
export async function mockStockInventory(query: StockScope & { orderIds?: string[]; customerId?: string; customerSearch?: string; page: number; pageSize: number }): Promise<StockInventoryPage> {
  const selected = scenario(query.orderIds)
  const rows = stock.filter(row => (!selected || selected.has(row.sku as typeof products[number][0]))
    && (!query.warehouseCode || query.warehouseCode === row.warehouseCode)
    && (!query.customerId || query.customerId === row.customerId)
    && matches(`${row.customerCode} ${row.customerName}`, query.customerSearch) && matches(`${row.sku} ${row.name}`, query.search))
  return { items: structuredClone(paginate(rows, query.page, query.pageSize)), total: rows.length, page: query.page, pageSize: query.pageSize, customerId: query.customerId ?? null, source: 'mock', refreshedAt: asOf }
}
export async function mockAllocationInventory(query: AllocationInventoryQuery): Promise<AllocationInventoryPage> {
  const selected = query.mode === 'selected' ? scenario(query.orderIds) : null
  const rows = pools.filter(row => (!selected || selected.has(row.sku as typeof products[number][0]))
    && (!query.warehouseCode || row.warehouseCode === query.warehouseCode)
    && (query.mode === 'selected' ? query.orderIds.length > 0 : !!query.search.trim() && matches(`${row.sku} ${row.name}`, query.search)))
  return { items: structuredClone(paginate(rows, query.page, query.pageSize)), total: rows.length, page: query.page, pageSize: query.pageSize, source: 'mock', asOf }
}
