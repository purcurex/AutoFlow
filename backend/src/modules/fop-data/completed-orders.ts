import { isProcurementCompleted } from './workbench-queue-rules'
import type { FopOrder } from './fop-data.types'
import { normalizeBusinessTimestamp } from './fop-business-time'

export const completionFields = {
  review: 'reviewedAt', dispatch: 'dispatchApprovedAt', procurement: 'procurementCompletedAt',
  allocation_review: 'allocationApprovedAt', shipping: 'outboundCompletedAt',
} as const
export type CompletionQueue = keyof typeof completionFields
export const completionLabels: Record<CompletionQueue, readonly [string, string]> = {
  review: ['已审核清单', 'Approved orders'], dispatch: ['已履约订单', 'Fulfilled orders'], procurement: ['采购完成清单', 'Completed purchases'],
  allocation_review: ['配货完成清单', 'Completed allocations'], shipping: ['已出库清单', 'Completed outbound'],
}
export const completionTimeLabels: Record<CompletionQueue, readonly [string, string]> = {
  review: ['订单审核时间', 'Order approval time'], dispatch: ['发运单审核时间', 'Shipment approval time'], procurement: ['采购完成时间', 'Purchase completion time'],
  allocation_review: ['配货审核时间', 'Allocation approval time'], shipping: ['出库完成时间', 'Outbound completion time'],
}
export function isCompletionQueue(queue: string): queue is CompletionQueue { return Object.prototype.hasOwnProperty.call(completionFields, queue) }
export function isStageCompleted(order: FopOrder, queue: string): boolean {
  if (queue === 'review') return order.reviewStatus === 'approved'
  if (!isCompletionQueue(queue) || order.cancelled || order.paymentStatus !== 'paid') return false
  if (queue !== 'procurement' && order.reviewStatus !== 'approved') return false
  const progress = order.fulfillmentProgress
  if (queue === 'dispatch') return progress?.shopifySync === 'synced'
  if (queue === 'procurement') return order.sourcePurchaseStatus !== undefined ? order.procurementProgress?.purchaseOrder !== 'not_required' && ['3','4'].includes(order.sourcePurchaseStatus ?? '') : isProcurementCompleted(order.procurementProgress, progress?.supplierShipment)
  if (progress?.allocationCreated !== true || progress.allocationReview !== 'approved') return false
  return queue === 'allocation_review' || progress.outbound === 'completed'
}
export function completedAt(order: FopOrder, queue: string): string | null {
  return isCompletionQueue(queue) && isStageCompleted(order, queue) ? normalizeBusinessTimestamp(order[completionFields[queue]]) : null
}
