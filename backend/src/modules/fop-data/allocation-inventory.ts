import { BadRequestException } from '@nestjs/common'
import { FopPermissionDeniedError } from './fop-data.types'
import { BusinessScope, matchesBusinessScope } from '../users/business-scope'

/** Independent permission over a physical inventory pool, including a confirmed empty pool. */
export interface AllocationInventoryScope {
  id: string; sku: string; name: string; warehouseCode: 'HZ' | 'SZ'; warehouse: string
  customer: { id: string; name: string } | null
  owner?: { id: string }; department?: { id: string }; departmentPathIds?: readonly string[]
}
export interface AllocationInventoryTarget { sku: string; warehouseCode: string; customerId: string }
export interface AllocationInventorySnapshot {
  complete: boolean; asOf: string
  items: { scopeId: string; onHand: number; occupied: number }[]
}
export const inventoryKey = (s: AllocationInventoryScope) => JSON.stringify([s.sku, s.warehouseCode, s.customer?.id ?? null])
export function inventoryTargets(scopes: readonly AllocationInventoryScope[] | undefined, business: BusinessScope, selected?: AllocationInventoryTarget[], search?: string, warehouseCode?: string) {
  if (!Array.isArray(scopes)) throw new FopPermissionDeniedError('Inventory permission is required')
  const ids = new Set<string>(), keys = new Set<string>()
  const text = (v: unknown) => typeof v === 'string' && !!v.trim()
  for (const s of scopes) {
    if (!s || !text(s.id) || !text(s.sku) || !text(s.name) || !text(s.warehouse) || !['HZ', 'SZ'].includes(s.warehouseCode)
      || s.customer !== null && (!s.customer || !text(s.customer.id) || !text(s.customer.name) || !text(s.owner?.id) || !text(s.department?.id))
      || s.departmentPathIds !== undefined && (!Array.isArray(s.departmentPathIds) || s.departmentPathIds.some((id: unknown) => !text(id)))
      || ids.has(s.id) || keys.has(inventoryKey(s))) throw new Error('Invalid inventory permission scope')
    ids.add(s.id); keys.add(inventoryKey(s))
  }
  const permitted = scopes.filter(s => s.customer === null || matchesBusinessScope(business, s))
  if (selected) {
    const required = new Set(selected.filter(s => !warehouseCode || s.warehouseCode === warehouseCode).flatMap(s => [JSON.stringify([s.sku, s.warehouseCode, null]), JSON.stringify([s.sku, s.warehouseCode, s.customerId])]))
    const result = permitted.filter(s => required.has(inventoryKey(s)))
    if (result.length !== required.size) throw new FopPermissionDeniedError('Inventory permission is required for all selected SKUs and customer pools')
    return result
  }
  if (!search?.trim()) throw new BadRequestException('SKU search is required')
  return permitted.filter(s => (!warehouseCode || s.warehouseCode === warehouseCode) && s.sku.toLowerCase().includes(search.trim().toLowerCase()))
}
export function inventorySnapshot(scopes: readonly AllocationInventoryScope[], snapshot: AllocationInventorySnapshot) {
  if (!snapshot || snapshot.complete !== true || typeof snapshot.asOf !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(snapshot.asOf) || !Number.isFinite(Date.parse(snapshot.asOf)) || !Array.isArray(snapshot.items)) throw new Error('Incomplete inventory snapshot')
  const allowed = new Set(scopes.map(s => s.id)), records = new Map<string, AllocationInventorySnapshot['items'][number]>()
  for (const row of snapshot.items) {
    if (!row || !allowed.has(row.scopeId) || records.has(row.scopeId) || ![row.onHand, row.occupied].every(q => typeof q === 'number' && Number.isFinite(q) && q >= 0 && q <= Number.MAX_SAFE_INTEGER)) throw new Error('Invalid inventory balance')
    records.set(row.scopeId, row)
  }
  return scopes.map(s => {
    const row = records.get(s.id) ?? { onHand: 0, occupied: 0 }
    return { id: s.id, sku: s.sku, name: s.name, warehouseCode: s.warehouseCode, warehouse: s.warehouse, customer: s.customer ? { id: s.customer.id, name: s.customer.name } : null,
      onHand: row.onHand, occupied: row.occupied, free: Math.max(0, row.onHand - row.occupied) }
  })
}
