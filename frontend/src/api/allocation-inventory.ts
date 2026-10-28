import api from './index'
export interface AllocationInventoryRow {
  id: string; sku: string; name: string; warehouseCode: 'HZ' | 'SZ'; warehouse: string
  customer: { id: string; name: string } | null
  onHand: number; occupied: number; free: number
}
export interface AllocationInventoryPage { items: AllocationInventoryRow[]; total: number; page: number; pageSize: number; asOf: string; source: 'mock' | 'fop' }
export type AllocationInventoryQuery = ({ mode: 'selected'; orderIds: string[] } | { mode: 'search'; search: string }) & { warehouseCode?: string; page: number; pageSize: number }
export const getAllocationInventory = (query: AllocationInventoryQuery) => api.post<AllocationInventoryPage, AllocationInventoryPage>('/autoflow/integrations/fop/allocation-inventory/query', query)
