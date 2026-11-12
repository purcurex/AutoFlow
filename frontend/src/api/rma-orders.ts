import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from './workbench-replica'
import api from './index'
import type { FopOrder, FopOrderTotals } from './fop-orders'
export const rmaTypeLabels = { refund: ['仅退款', 'Refund only'], return_refund: ['退货退款', 'Return and refund'], reshipment: ['补发货', 'Reshipment'] } as const
export type RmaType = keyof typeof rmaTypeLabels
export type RmaCaseType = RmaType | 'interception' | 'cancellation' | 'interception_release'
export const rmaOrderTagLabels = { cancelled: ['订单取消', 'Order cancelled'], cancellation_requested: ['订单取消', 'Order cancellation'], intercepted: ['订单拦截', 'Order intercepted'], interception_released: ['拦截取消', 'Interception cancelled'] } as const
export type RmaOrderTag = keyof typeof rmaOrderTagLabels
export interface RmaCase { id: string; orderId: string; type: RmaCaseType; isOpen: boolean | null; number: string | null; stage: string | null; reason: string | null; refundAmount?: number | null; refundCurrency?: string | null; requestedAmount: number | null; currency: string | null; createdAt: string | null; updatedAt: string | null }
export interface RmaOrder extends FopOrder { sourceOrderId?: string; rmaCases: RmaCase[]; rmaUpdatedAt: string | null; orderTags?: RmaOrderTag[]; refundAmounts?: { currency: string | null; amount: number | null }[] }
export interface RmaFilters { type?: RmaType; flowStatus: 'active' | 'closed' | 'all'; search?: string; departmentId?: string; ownerId?: string; warehouseCode?: 'HZ' | 'SZ' }
export interface RmaQuery extends RmaFilters { page: number; pageSize: number }
export interface RmaPage {
  dataAvailability?: WorkbenchDataAvailability; replica?: WorkbenchReplicaSnapshot
 items: RmaOrder[]; total: number; page: number; pageSize: number; departments: { id: string; name: string }[]; totals: FopOrderTotals & { caseCount: number }; source: 'mock' | 'fop'; refreshedAt: string }
export function hasRmaTypeConflict(cases: readonly (Pick<RmaCase, 'type'> & Partial<Pick<RmaCase, 'isOpen'>>)[]): boolean {
  const active = cases.filter(item => item.isOpen !== false && item.isOpen !== null)
  return active.some(item => item.type === 'refund') && active.some(item => item.type === 'return_refund' || item.type === 'reshipment')
}
const filters = (q: RmaFilters) => ({ type: q.type, flowStatus: q.flowStatus, search: q.search, departmentId: q.departmentId, ownerId: q.ownerId, warehouseCode: q.warehouseCode })
export function getRmaOrders(query: RmaQuery, signal?: AbortSignal): Promise<RmaPage> { return api.get('/autoflow/integrations/fop/rma-orders', { params: { ...filters(query), page: query.page, pageSize: query.pageSize }, signal }) }
export async function exportRmaOrders(query: RmaFilters, mode: 'selected' | 'filtered', caseIds: string[], signal?: AbortSignal): Promise<Blob> {
  try { return await api.post('/autoflow/integrations/fop/rma-orders/export', { ...filters(query), mode, ...(mode === 'selected' ? { caseIds } : {}) }, { responseType: 'blob', timeout: 30000, signal }) }
  catch (cause) { if (cause instanceof Blob) { let parsed: unknown; try { parsed = JSON.parse(await cause.text()) } catch { throw new Error('Export failed') } throw parsed } throw cause }
}
