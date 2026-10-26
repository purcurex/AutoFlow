import type { LocationQueryRaw } from 'vue-router'
import type { FopOrderQueue } from '@/api/fop-orders'

/** Dashboard queue order: review, fulfillment, procurement, allocation, outbound. */
export const workbenchRoles = ['sales', 'dispatch', 'procurement', 'allocation', 'warehouse'] as const
export type WorkbenchRole = typeof workbenchRoles[number]
export const workbenchQueues: Record<WorkbenchRole, readonly FopOrderQueue[]> = {
  sales: ['unpaid', 'review', 'exceptions'], procurement: ['procurement', 'procurement_shipping'], allocation: ['allocation', 'allocation_review'], dispatch: ['dispatch'], warehouse: ['shipping'],
}
export const workbenchNames: Record<WorkbenchRole, readonly [string, string]> = {
  sales: ['销售工作台', 'Sales Workbench'], procurement: ['采购工作台', 'Procurement Workbench'], allocation: ['配货工作台', 'Allocation Workbench'], dispatch: ['发运工作台', 'Shipment Workbench'], warehouse: ['仓库工作台', 'Warehouse Workbench'],
}
export const queueNames: Record<FopOrderQueue, readonly [string, string]> = {
  procurement_shipping: ['已采购待发货', 'Purchased · shipment pending'], allocation_review: ['已齐套待审核', 'Fully allocated · approval pending'],
  unpaid: ['待支付', 'Pending payment'], review: ['待审核', 'Pending review'], procurement: ['待采购', 'Pending purchase'], allocation: ['待配货', 'Pending allocation'], dispatch: ['待履约', 'Pending fulfillment'], shipping: ['待出库', 'Pending outbound'], exceptions: ['异常订单', 'Order exceptions'],
}
export function isWorkbenchRole(value: unknown): value is WorkbenchRole {
  return typeof value === 'string' && (workbenchRoles as readonly string[]).includes(value)
}
export function roleForQueue(queue: FopOrderQueue): WorkbenchRole {
  return ({ unpaid: 'sales', review: 'sales', exceptions: 'sales', procurement: 'procurement', procurement_shipping: 'procurement', allocation: 'allocation', allocation_review: 'allocation', dispatch: 'dispatch', shipping: 'warehouse' } as const)[queue]
}
export function workbenchOrderLocation(queue: FopOrderQueue, query: LocationQueryRaw = {}) {
  return { name: 'RoleWorkbench', params: { role: roleForQueue(queue) }, query: { ...query, queue } }
}
export function defaultWorkbenchQueue(role: WorkbenchRole) {
  // Landing pages are independent of tab order; sales and allocation open their review queues.
  return ({ sales: 'review', dispatch: 'dispatch', procurement: 'procurement', allocation: 'allocation_review', warehouse: 'shipping' } as const)[role]
}
