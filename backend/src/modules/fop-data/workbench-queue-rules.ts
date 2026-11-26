import { hasDispatchException } from './order-dispatch-status'
import type { FopOrder, ProcurementProgress } from './fop-data.types'
import type { FULFILLMENT_QUEUE_ROLES, ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'

export type Queue = keyof typeof FULFILLMENT_QUEUE_ROLES

/** Purchasing readiness precedes supplier shipment. */
export function isProcurementReady(purchase: ProcurementProgress | undefined): boolean {
  return purchase?.purchaseOrder === 'ordered' && purchase.supplierPayment === 'paid'
    && (purchase.alibabaOrder === 'pushed' || purchase.alibabaOrder === 'not_required')
}

export function matchesQueue(order: FopOrder, queue: Queue, warehouseStage?: ListFulfillmentOrdersDto['warehouseStage']): boolean {
  if (queue === 'exceptions' && order.businessStatus?.order === 'fulfillment_cancelled') return true
  if (queue === 'exceptions' && hasDispatchException(order)) return true
  if (queue === 'dispatch' && order.businessStatus) return order.reviewStatus === 'approved' && !order.cancelled && !['cancelled','fulfillment_cancelled'].includes(order.businessStatus.order) && ['unfulfilled','partial'].includes(order.businessStatus.sourceShipment)
  if (order.cancelled) return false
  if (queue === 'exceptions') return order.exception != null
  if (queue === 'unpaid') return order.paymentStatus === 'unpaid' && !['refunded', 'voided', 'expired', 'unpaid'].includes(order.sourcePaymentStatus ?? '')
  if (order.paymentStatus !== 'paid') return false
  if (queue === 'review') return order.reviewStatus === 'pending'
  const progress = order.fulfillmentProgress
  if (!progress) return false
  // 已审核且待同步履约；真实采集以履约本单订单状态为准。
  if (queue === 'dispatch') return order.reviewStatus === 'approved' && progress.shopifySync === 'pending'
  if (queue === 'procurement' || queue === 'procurement_shipping') {
    if (order.reviewStatus !== 'approved') return false
    if (order.sourcePurchaseStatus !== undefined && !['0','1','2'].includes(order.sourcePurchaseStatus ?? '')) return false
    const purchase = order.procurementProgress
    if (!purchase || purchase.purchaseOrder === 'not_required' || (order.sourcePurchaseStatus === undefined && progress.supplierShipment === 'shipped')) return false
    const pendingPush = purchase.alibabaOrder === 'not_pushed' || purchase.alibabaOrder === 'partial'
    if (queue === 'procurement_shipping') return isProcurementReady(purchase)
      && (progress.supplierShipment === 'pending' || progress.supplierShipment === 'partial')
    // Remaining unplaced demand is not fully paid; unknown facts are not unpaid facts.
    return purchase.purchaseOrder === 'not_ordered' || purchase.purchaseOrder === 'partial'
      || purchase.purchaseOrder === 'ordered' && (pendingPush || ['unpaid', 'partial', 'refunded'].includes(purchase.supplierPayment))
  }
  if (order.reviewStatus !== 'approved' || progress.allocationCreated !== true) return false
  switch (queue) {
    case 'allocation': return progress.stockReadiness === 'incomplete' && progress.allocationReview === 'pending'
    case 'allocation_review': return progress.stockReadiness === 'ready' && progress.allocationReview === 'pending'
    // Pending allocation approval belongs only to allocation; legacy pending_review queries stay empty.
    case 'shipping': return warehouseStage !== 'pending_review' && progress.stockReadiness === 'ready'
      && progress.allocationReview === 'approved' && (progress.outbound === 'pending' || progress.outbound === 'partial')
  }
  return false
}


/** Completed purchases have been fully shipped by the supplier. */
export function isProcurementCompleted(purchase: ProcurementProgress | undefined, shipment?: string): boolean {
  return purchase?.purchaseOrder === 'ordered' && shipment === 'shipped'
}
