import type { DispatchDocument, FopOrder, FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'
import { getProcurementStage, procurementStageLabels, procurementStageOptions, type ProcurementStage } from './procurement-stage'

export const taskStatuses = [...new Set(['dispatch_incomplete', 'dispatch_complete', ...Object.keys(procurementStageLabels), 'dispatch_preparation', 'dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'dispatch_synced', 'logistics_pending', 'outbound_pending', 'outbound_partial', 'procurement_exception', 'dispatch_exception', 'allocation_exception', 'logistics_exception', 'delivery_exception', 'stock_exception', 'address_exception'])] as TaskStatus[]
export type TaskStatus = ProcurementStage | 'dispatch_incomplete' | 'dispatch_complete' | 'dispatch_preparation' | 'dispatch_missing' | 'dispatch_draft' | 'dispatch_submitted' | 'dispatch_approved' | 'dispatch_synced' | 'logistics_pending' | 'outbound_pending' | 'outbound_partial' | 'procurement_exception' | 'dispatch_exception' | 'allocation_exception' | 'logistics_exception' | 'delivery_exception' | 'stock_exception' | 'address_exception'
export const taskStatusLabels: Record<TaskStatus, readonly [string, string]> = { ...procurementStageLabels,
  dispatch_incomplete: ['未完成', 'Incomplete'], dispatch_complete: ['已完成', 'Complete'],
  dispatch_preparation: ['待制作发运单', 'Dispatch preparation pending'],
  dispatch_missing: ['待建发运单', 'Dispatch document needed'], dispatch_draft: ['暂存', 'Draft'], dispatch_submitted: ['已提交', 'Submitted'], dispatch_approved: ['已审核', 'Approved'], dispatch_synced: ['已同步', 'Synced'],
  logistics_pending: ['待获取物流单号', 'Logistics order number needed'],
  outbound_pending: ['待出库', 'Awaiting outbound'], outbound_partial: ['部分出库', 'Partly outbound'],
  stock_exception: ['库存不足', 'Insufficient stock'], address_exception: ['地址待核验', 'Address verification needed'],
  procurement_exception: ['采购异常', 'Procurement exception'], dispatch_exception: ['发运异常', 'Dispatch exception'], allocation_exception: ['配货异常', 'Allocation exception'], logistics_exception: ['物流异常', 'Logistics exception'], delivery_exception: ['妥投异常', 'Delivery exception'],
}
/** Labels are contextual: procurement retains an actionable collaboration instruction. */
export function taskStatusLabel(status: TaskStatus, queue: string): readonly [string, string] {
  if (queue === 'dispatch' && status === 'dispatch_approved') return ['已审核未同步', 'Approved · sync pending']
  return status === 'dispatch_missing' && ['dispatch', 'allocation', 'allocation_review'].includes(queue)
    ? ['未创建', 'Not created'] : taskStatusLabels[status]
}
export function taskStatusOptions(queue: string): readonly TaskStatus[] {
  if (queue === 'procurement') return ['application_pending', 'purchase_order_pending', 'placement_pending', 'dispatch_preparation', 'alibaba_pending', 'payment_pending', 'refund_pending']
  if (queue === 'procurement_shipping') return procurementStageOptions(queue)
  if (queue === 'dispatch') return ['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved']
  if (queue === 'allocation' || queue === 'allocation_review') return ['dispatch_incomplete', 'dispatch_complete']
  if (queue === 'shipping') return ['outbound_pending', 'outbound_partial']
  if (queue === 'exceptions') return ['stock_exception', 'address_exception', 'procurement_exception', 'dispatch_exception', 'allocation_exception', 'logistics_exception', 'delivery_exception']
  return []
}
export function canFilterTaskStatus(queue: string, value: unknown): value is TaskStatus {
  return typeof value === 'string' && taskStatusOptions(queue).includes(value as TaskStatus)
}
export function taskStatusHeading(queue: string): readonly [string, string] {
  if (queue === 'procurement') return ['采购进度', 'Procurement progress']
  if (queue === 'procurement_shipping') return ['供应商发货状态', 'Supplier shipment status']
  if (queue === 'shipping') return ['出库进度', 'Outbound progress']
  if (queue === 'exceptions') return ['异常类型', 'Exception type']
  return ['发运单状态', 'Dispatch document status']
}
export function getDispatchCompletionStatus(documents?: DispatchDocument[] | null, complete?: boolean): TaskStatus {
  return complete !== false && documents?.length && documents.every(document => document.status === 'approved') ? 'dispatch_complete' : 'dispatch_incomplete'
}
export function getDispatchTaskStatus(documents?: DispatchDocument[] | null, shopifySync?: FulfillmentProgress['shopifySync']): TaskStatus {
  if (!documents || documents.some(doc => !['draft', 'submitted', 'approved'].includes(doc.status))) return 'unknown'
  if (!documents.length) return 'dispatch_missing'
  if (documents.some(doc => doc.status === 'draft')) return 'dispatch_draft'
  if (documents.some(doc => doc.status === 'submitted')) return 'dispatch_submitted'
  return shopifySync === 'synced' ? 'dispatch_synced' : 'dispatch_approved'
}
export function getProcurementTaskStatus(p: ProcurementProgress | undefined, shipment: FulfillmentProgress['supplierShipment']): TaskStatus {
  const stage = getProcurementStage(p, shipment)
  if (stage !== 'alibaba_pending') return stage
  if (p?.logisticsGate === 'pending_dispatch' || p?.logisticsGate === 'pending_logistics') return 'dispatch_preparation'
  return stage
}
export function getTaskStatus(order: Pick<FopOrder, 'dispatchTaskStatus' | 'dispatchDocumentsComplete' | 'dispatchDocuments' | 'procurementProgress' | 'fulfillmentProgress' | 'exception'>, queue: string): TaskStatus {
  if (queue === 'procurement' || queue === 'procurement_shipping') return getProcurementTaskStatus(order.procurementProgress, order.fulfillmentProgress.supplierShipment)
  if (queue === 'allocation' || queue === 'allocation_review') return getDispatchCompletionStatus(order.dispatchDocuments, order.dispatchDocumentsComplete)
  if (queue === 'dispatch') return order.dispatchTaskStatus ?? getDispatchTaskStatus(order.dispatchDocuments, order.fulfillmentProgress.shopifySync)
  if (queue === 'shipping') return order.fulfillmentProgress.outbound === 'partial' ? 'outbound_partial' : order.fulfillmentProgress.outbound === 'pending' ? 'outbound_pending' : 'unknown'
  if (queue === 'exceptions') return order.exception?.type ?? 'unknown'
  return 'unknown'
}
