import type { PurchaseGroup } from '@/api/procurement-groups'
/** Display emphasis only: preserve all facts and existing queue membership. */
export function purchaseCurrentStage(group: PurchaseGroup): 'placement' | 'payment' | 'shipment' | undefined {
  const purchase = group.purchase
  if (!purchase) return undefined
  if (purchase.payment === 'refunded' || purchase.payment === 'partially_refunded') return 'payment'
  if (purchase.placement !== 'placed') return 'placement'
  if (purchase.payment !== 'paid') return 'payment'
  if (group.shipment !== 'shipped') return 'shipment'
  return undefined
}
