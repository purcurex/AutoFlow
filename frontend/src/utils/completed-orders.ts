import type { FopOrder, FopOrderQueue } from '@/api/fop-orders'
import type { WorkbenchRole } from './workbench'
import { orderTimestamp } from './order-timestamp'
export const completedQueues: Record<WorkbenchRole, FopOrderQueue> = { sales: 'review', dispatch: 'dispatch', procurement: 'procurement', allocation: 'allocation_review', warehouse: 'shipping' }
export const completedNames: Record<WorkbenchRole, readonly [string, string]> = {
  sales: ['已完成清单', 'Completed orders'], dispatch: ['已履约订单', 'Fulfilled orders'], procurement: ['采购完成清单', 'Completed purchases'],
  allocation: ['配货完成清单', 'Completed allocations'], warehouse: ['已出库清单', 'Completed outbound'],
}
export const completedTimeNames: Record<WorkbenchRole, readonly [string, string]> = {
  sales: ['订单审核时间', 'Order approval time'], dispatch: ['发运单审核时间', 'Shipment approval time'], procurement: ['采购完成时间', 'Purchase completion time'],
  allocation: ['配货审核时间', 'Allocation approval time'], warehouse: ['出库完成时间', 'Outbound completion time'],
}
export function completionTime(order: FopOrder, role: WorkbenchRole): string | null {
  const value = order[({ sales: 'reviewedAt', dispatch: 'dispatchApprovedAt', procurement: 'procurementCompletedAt', allocation: 'allocationApprovedAt', warehouse: 'outboundCompletedAt' } as const)[role]]
  const at = orderTimestamp(value)
  return at === null ? null : new Date(at).toISOString()
}
/** Validate archive responses against completion facts, independently of pending queue rules. */
export function matchesCompletedQueue(order: FopOrder, queue: FopOrderQueue): boolean {
  if (order.cancelled || order.paymentStatus !== 'paid') return false
  if (queue !== 'procurement' && order.reviewStatus !== 'approved') return false
  if (queue === 'review') return true
  const progress = order.fulfillmentProgress
  if (queue === 'dispatch') return progress.shopifySync === 'synced'
  if (queue === 'procurement') {
    const purchase = order.procurementProgress
    return purchase?.purchaseOrder === 'ordered' && purchase.supplierPayment === 'paid' && (purchase.alibabaOrder === 'pushed' || purchase.alibabaOrder === 'not_required')
  }
  return progress.allocationCreated === true && progress.allocationReview === 'approved'
    && (queue === 'allocation_review' || queue === 'shipping' && progress.outbound === 'completed')
}
