import type { FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'

export const procurementStages = ['application_pending', 'purchase_order_pending', 'alibaba_pending', 'payment_pending', 'refund_pending', 'supplier_pending', 'supplier_partial', 'shipped', 'cancelled', 'not_required', 'unknown'] as const
export type ProcurementStage = typeof procurementStages[number]
export const procurementStageLabels: Record<ProcurementStage, readonly [string, string]> = {
  application_pending: ['待建采购申请', 'Purchase application pending'], purchase_order_pending: ['待建采购订单', 'Purchase order pending'],
  alibaba_pending: ['待推1688采购', '1688 purchase push pending'], payment_pending: ['待支付采购款', 'Purchase payment pending'],
  refund_pending: ['采购退款待跟进', 'Purchase refund follow-up'],
  supplier_pending: ['供应商待发货', 'Awaiting supplier shipment'], supplier_partial: ['供应商部分发货', 'Supplier partly shipped'],
  shipped: ['供应商已发货', 'Supplier shipped'], cancelled: ['采购单已取消', 'Purchase order cancelled'],
  not_required: ['无需采购', 'Purchase not required'], unknown: ['待确认', 'Unconfirmed'],
}
export function isProcurementStage(value: unknown): value is ProcurementStage {
  return typeof value === 'string' && (procurementStages as readonly string[]).includes(value)
}
export function procurementStageOptions(queue: string): readonly ProcurementStage[] {
  if (queue === 'procurement') return ['purchase_order_pending', 'alibaba_pending', 'payment_pending', 'refund_pending']
  if (queue === 'procurement_shipping') return ['supplier_pending', 'supplier_partial']
  return []
}
export function canFilterProcurementStage(queue: string, value: unknown): value is ProcurementStage {
  return isProcurementStage(value) && procurementStageOptions(queue).includes(value)
}
/** A single stage drives the displayed badge and server-side filter. Unknown facts never imply payment. */
export function getProcurementStage(p: ProcurementProgress | undefined, shipment: FulfillmentProgress['supplierShipment']): ProcurementStage {
  if (p?.supplierPayment === 'refunded') return 'refund_pending'
  if (p?.purchaseOrder === 'cancelled') return 'cancelled'
  if (p?.purchaseOrder === 'not_required') return 'not_required'
  if (p?.purchaseOrder === 'not_ordered') return 'purchase_order_pending' // FOP creates the purchase application automatically after fulfillment approval.
  // Compatibility only: FOP has no partially created purchase orders in the current workflow.
  if (p?.purchaseOrder === 'partial') return 'purchase_order_pending'
  if (p?.purchaseOrder !== 'ordered') return 'unknown'
  if (p.alibabaOrder === 'not_pushed' || p.alibabaOrder === 'partial') return 'alibaba_pending'
  if (p.supplierPayment === 'unpaid') return 'payment_pending'
  if (p.supplierPayment === 'partial') return 'payment_pending' // Legacy incomplete payment remains actionable.
  if (p.supplierPayment !== 'paid') return 'unknown'
  if (shipment === 'pending') return 'supplier_pending'
  if (shipment === 'partial') return 'supplier_partial'
  if (shipment === 'shipped') return 'shipped'
  return 'unknown'
}
