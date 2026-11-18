import type { FopOrder, FopOrderQueue } from '@/api/fop-orders'

/** Mirror native allocation membership; parent outbound/payment/cancellation are separate facts. */
export function matchesCollectedAllocation(order: FopOrder, queue: FopOrderQueue, completed = false): boolean {
  if (queue !== 'allocation' && queue !== 'allocation_review' || completed && queue !== 'allocation_review') return false
  if (order.dataQuality?.mode !== 'collected' || !order.dataQuality.readOnly || order.reviewStatus !== 'approved') return false
  const documents = order.allocationDocuments?.filter(doc => doc.rawAllocationStatus !== 'voided')
  if (!documents?.length || documents.some(doc => !['A', 'B', 'C'].includes(doc.rawBillStatus ?? '') || doc.association && doc.association.state !== 'verified')) return false
  if (completed) return documents.every(doc => doc.rawBillStatus === 'C' && doc.rawAllocationStatus === 'completed')
  const pending = documents.filter(doc => doc.rawBillStatus === 'A' || doc.rawBillStatus === 'B')
  if (!pending.length) return false
  return queue === 'allocation_review'
    ? pending.every(doc => doc.rawAllocationStatus === 'completed')
    : pending.every(doc => ['pending', 'available', 'completed'].includes(doc.rawAllocationStatus ?? ''))
      && pending.some(doc => doc.rawAllocationStatus === 'pending' || doc.rawAllocationStatus === 'available')
}
