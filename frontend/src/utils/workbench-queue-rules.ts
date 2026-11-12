import type { ProcurementProgress } from '@/api/fop-orders'

/** Purchasing readiness precedes supplier shipment. */
export function isProcurementReady(purchase: ProcurementProgress | undefined): boolean {
  return purchase?.purchaseOrder === 'ordered' && purchase.supplierPayment === 'paid'
    && (purchase.alibabaOrder === 'pushed' || purchase.alibabaOrder === 'not_required')
}

/** Completed purchases have been fully shipped by the supplier. */
export function isProcurementCompleted(purchase: ProcurementProgress | undefined, shipment?: string): boolean {
  return purchase?.purchaseOrder === 'ordered' && shipment === 'shipped'
}
