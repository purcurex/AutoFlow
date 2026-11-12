import type { DispatchDocument, FopOrder, FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'
import { getProcurementStage, procurementStageLabels, procurementStageOptions, type ProcurementStage } from './procurement-stage'

export const taskStatuses = [...new Set(['dispatch_incomplete', 'dispatch_complete', ...Object.keys(procurementStageLabels), 'dispatch_preparation', 'dispatch_pending', 'dispatch_tracking', 'dispatch_updating', 'dispatch_cancelled', 'dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'dispatch_synced', 'logistics_pending', 'outbound_pending', 'shipment_intercepted', 'shipment_released', 'procurement_exception', 'dispatch_exception', 'allocation_exception', 'logistics_exception', 'delivery_exception'])] as TaskStatus[]
export type TaskStatus = ProcurementStage | 'dispatch_incomplete' | 'dispatch_complete' | 'dispatch_preparation' | 'dispatch_pending' | 'dispatch_tracking' | 'dispatch_updating' | 'dispatch_cancelled' | 'dispatch_missing' | 'dispatch_draft' | 'dispatch_submitted' | 'dispatch_approved' | 'dispatch_synced' | 'logistics_pending' | 'outbound_pending' | 'shipment_intercepted' | 'shipment_released' | 'procurement_exception' | 'dispatch_exception' | 'allocation_exception' | 'logistics_exception' | 'delivery_exception'
export const taskStatusLabels: Record<TaskStatus, readonly [string, string]> = { ...procurementStageLabels,
  dispatch_pending: ['待处理', 'Pending'], dispatch_tracking: ['已取号未同步', 'Tracking obtained'], dispatch_updating: ['更正中', 'Updating'], dispatch_cancelled: ['已取消', 'Cancelled'],
  dispatch_incomplete: ['未完成', 'Incomplete'], dispatch_complete: ['已完成', 'Complete'],
  dispatch_preparation: ['待制作发运单', 'Dispatch preparation pending'],
  dispatch_missing: ['待建发运单', 'Dispatch document needed'], dispatch_draft: ['暂存', 'Draft'], dispatch_submitted: ['已提交', 'Submitted'], dispatch_approved: ['已审核', 'Approved'], dispatch_synced: ['已同步', 'Synced'],
  logistics_pending: ['待获取物流单号', 'Logistics order number needed'],
  outbound_pending: ['待出库', 'Awaiting outbound'], shipment_intercepted: ['拦截发货', 'Shipment intercepted'], shipment_released: ['取消拦截', 'Interception released'],
  procurement_exception: ['采购退货', 'Purchase return'], dispatch_exception: ['订单取消', 'Order cancellation'], allocation_exception: ['配货超时', 'Allocation overdue'], logistics_exception: ['物流异常', 'Logistics exception'], delivery_exception: ['妥投异常', 'Delivery exception'],
}
/** Labels are contextual: procurement retains an actionable collaboration instruction. */
export function taskStatusLabel(status: TaskStatus, queue: string): readonly [string, string] {
  if (queue === 'dispatch' && status === 'dispatch_synced') return ['已发货', 'Fulfilled']
  return status === 'dispatch_missing' && ['dispatch', 'allocation', 'allocation_review'].includes(queue)
    ? ['未创建', 'Not created'] : taskStatusLabels[status]
}
export function taskStatusOptions(queue: string): readonly TaskStatus[] {
  if (queue === 'procurement') return ['purchase_order_pending', 'dispatch_preparation', 'alibaba_pending', 'payment_pending', 'refund_pending']
  if (queue === 'procurement_shipping') return procurementStageOptions(queue)
  if (queue === 'dispatch') return ['dispatch_missing', 'dispatch_pending', 'dispatch_tracking', 'dispatch_updating', 'dispatch_cancelled']
  if (queue === 'allocation' || queue === 'allocation_review') return ['dispatch_incomplete', 'dispatch_complete']
  if (queue === 'shipping') return ['outbound_pending', 'shipment_intercepted', 'shipment_released']
  if (queue === 'exceptions') return ['procurement_exception', 'dispatch_exception', 'allocation_exception', 'logistics_exception', 'delivery_exception']
  return []
}
export function canFilterTaskStatus(queue: string, value: unknown): value is TaskStatus {
  return typeof value === 'string' && taskStatusOptions(queue).includes(value as TaskStatus)
}
export function taskStatusHeading(queue: string): readonly [string, string] {
  if (queue === 'procurement') return ['采购进度', 'Procurement progress']
  if (queue === 'procurement_shipping') return ['供应商发货状态', 'Supplier shipment status']
  if (queue === 'dispatch') return ['履约状态', 'Fulfillment status']
  if (queue === 'shipping') return ['出库进度', 'Outbound progress']
  if (queue === 'exceptions') return ['异常类型', 'Exception type']
  return ['发运单状态', 'Dispatch document status']
}
export function getDispatchCompletionStatus(documents?: DispatchDocument[] | null): TaskStatus {
  return documents?.length && documents.every(document => document.status === 'approved') ? 'dispatch_complete' : 'dispatch_incomplete'
}
export function getDispatchTaskStatus(documents?: DispatchDocument[] | null, _shopifySync?: FulfillmentProgress['shopifySync']): TaskStatus {
  if (!documents) return 'unknown'
  if (!documents.length) return 'dispatch_missing'
  const states = documents.map(document => document.deliveryStatus)
  if (states.some(state => !state || !['PENDING','TRACKING_OBTAINED','FULFILLED','UPDATING','CANCELLED'].includes(state))) return 'unknown'
  if (states.every(state => state === 'FULFILLED')) return 'dispatch_synced'
  if (states.includes('UPDATING')) return 'dispatch_updating'
  if (states.includes('CANCELLED')) return 'dispatch_cancelled'
  if (states.includes('PENDING')) return 'dispatch_pending'
  return 'dispatch_tracking'
}
export function getProcurementTaskStatus(p: ProcurementProgress | undefined, shipment: FulfillmentProgress['supplierShipment']): TaskStatus {
  const stage = getProcurementStage(p, shipment)
  if (stage !== 'alibaba_pending') return stage
  if (p?.logisticsGate === 'pending_dispatch' || p?.logisticsGate === 'pending_logistics') return 'dispatch_preparation'
  return stage
}
export function getTaskStatus(order: Pick<FopOrder, 'dispatchTaskStatus' | 'dispatchDocuments' | 'procurementProgress' | 'fulfillmentProgress' | 'exception'>, queue: string): TaskStatus {
  if (queue === 'procurement' || queue === 'procurement_shipping') return getProcurementTaskStatus(order.procurementProgress, order.fulfillmentProgress.supplierShipment)
  if (queue === 'allocation' || queue === 'allocation_review') return getDispatchCompletionStatus(order.dispatchDocuments)
  if (queue === 'dispatch') return order.dispatchTaskStatus ?? getDispatchTaskStatus(order.dispatchDocuments, order.fulfillmentProgress.shopifySync)
  if (queue === 'shipping') return ['pending', 'partial'].includes(order.fulfillmentProgress.outbound) ? 'outbound_pending' : 'unknown'
  if (queue === 'exceptions') return order.exception?.type ?? 'unknown'
  return 'unknown'
}

/** Interception is an independent filter; it never changes the outbound progress. */
export function matchesTaskStatus(order: FopOrder, queue: string, status: TaskStatus): boolean {
  if (!canFilterTaskStatus(queue, status)) return false
  if (queue === 'shipping' && status === 'outbound_pending') return getTaskStatus(order, queue) === status && order.shipmentInterceptStatus !== 'intercepted'
  if (queue === 'shipping' && status === 'shipment_intercepted') return order.shipmentInterceptStatus === 'intercepted'
  if (queue === 'shipping' && status === 'shipment_released') return order.shipmentInterceptStatus === 'released'
  return getTaskStatus(order, queue) === status
}
