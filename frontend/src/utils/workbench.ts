import type { LocationQueryRaw } from 'vue-router'
import type { FopOrderQueue } from '@/api/fop-orders'

/** Operational views, not authentication roles. Server permissions remain authoritative. */
export const workbenchRoles = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'] as const
export type WorkbenchRole = typeof workbenchRoles[number]
export const workbenchQueues: Record<WorkbenchRole, readonly FopOrderQueue[]> = {
  sales: ['review', 'exceptions'], procurement: ['procurement'], allocation: ['allocation'], dispatch: ['dispatch'], warehouse: ['shipping'],
}
export const workbenchNames: Record<WorkbenchRole, readonly [string, string]> = {
  sales: ['销售工作台', 'Sales Workbench'], procurement: ['采购工作台', 'Procurement Workbench'], allocation: ['配货工作台', 'Allocation Workbench'], dispatch: ['发运工作台', 'Shipment Workbench'], warehouse: ['仓库工作台', 'Warehouse Workbench'],
}
export const queueNames: Record<FopOrderQueue, readonly [string, string]> = {
  review: ['待审核', 'Pending review'], procurement: ['待采购', 'Pending purchase'], allocation: ['待配货', 'Pending allocation'], dispatch: ['待发运', 'Pending shipment'], shipping: ['待发货', 'Pending dispatch'], exceptions: ['异常订单', 'Order exceptions'],
}
export function isWorkbenchRole(value: unknown): value is WorkbenchRole {
  return typeof value === 'string' && (workbenchRoles as readonly string[]).includes(value)
}
export function roleForQueue(queue: FopOrderQueue): WorkbenchRole {
  return ({ review: 'sales', exceptions: 'sales', procurement: 'procurement', allocation: 'allocation', dispatch: 'dispatch', shipping: 'warehouse' } as const)[queue]
}
export function workbenchOrderLocation(queue: FopOrderQueue, query: LocationQueryRaw = {}) {
  return { name: 'RoleWorkbench', params: { role: roleForQueue(queue) }, query: { ...query, queue } }
}
export function defaultWorkbenchQueue(role: WorkbenchRole) {
  return role === 'sales' ? 'overview' : workbenchQueues[role][0]!
}
