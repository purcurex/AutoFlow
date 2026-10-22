import api from './index'
import type { FopOrderPage } from './fop-orders'
import type { WorkbenchRole } from '@/utils/workbench'
export type VolumeCategory = 'carrier' | 'organization' | 'salesperson' | 'customer'
export type VolumeGrain = 'month' | 'week' | 'day'
export type VolumeWarehouse = 'HZ' | 'SZ' | 'UNASSIGNED'
export interface OrderVolumeQuery {
  category: VolumeCategory; grain?: VolumeGrain; year?: number; month?: number; weekOf?: string
  from?: string; to?: string
  department?: string; objectId?: string; customerId?: string; warehouse: 'ALL' | VolumeWarehouse
}
export interface VolumePeriod { id: string; label: string; from: string; to: string; future: boolean }
export interface VolumeSeries {
  id: string; label: string; kind: 'total' | 'detail' | 'other' | 'unassigned'; entityId?: string; code?: string
  total: number; values: (number | null)[]; warehouses: Record<VolumeWarehouse, (number | null)[]>
  /** Customer analytics: same authorized orders, periods and warehouse mapping as counts. */
  amounts?: { currency: 'USD'; total: number; values: (number | null)[]; warehouses: Record<VolumeWarehouse, (number | null)[]>; excludedOrderCount: number }
}
export interface OrderVolumeData {
  source: 'mock' | 'fop'; query: OrderVolumeQuery; timeZone: string; asOf: string; total: number; customerCount: number
  periods: VolumePeriod[]; series: VolumeSeries[]
  options: { departments: { id: string; label: string }[]; objects: { id: string; label: string }[] }
}
export interface OrderCustomer { id: string; code: string; name: string; departments: string[] }
export interface OrderCustomerPage { source: 'mock' | 'fop'; items: OrderCustomer[]; total: number; page: number; pageSize: number }
export interface OrderVolumeDetailsQuery extends OrderVolumeQuery { workbenchRole: WorkbenchRole; detailWarehouse?: VolumeWarehouse; seriesId?: string; periodId?: string; page: number; pageSize: number }
const root = '/autoflow/integrations/fop/order-volume'
export const getOrderVolume = (query: OrderVolumeQuery): Promise<OrderVolumeData> => api.get(root, { params: query })
export const searchOrderCustomers = (query: { keyword: string; department?: string; page: number; pageSize: number }): Promise<OrderCustomerPage> => api.get(`${root}/customers`, { params: query })
export const getOrderVolumeDetails = (query: OrderVolumeDetailsQuery): Promise<FopOrderPage> => api.get(`${root}/orders`, { params: query })
