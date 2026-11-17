import type { FopOrder, FopOrderQueue } from '@/api/fop-orders'

/** Mirror native allocation membership; parent payment/cancellation is a separate captured fact. */
export function matchesCollectedAllocation(order: FopOrder, queue: FopOrderQueue, completed = false): boolean {
  if (queue !== 'allocation' && queue !== 'allocation_review' || completed && queue !== 'allocation_review') return false
  if (order.dataQuality?.mode !== 'collected' || !order.dataQuality.readOnly || order.reviewStatus !== 'approved') return false
  const documents = order.allocationDocuments
  if (!documents?.length || documents.some(doc => !['A', 'B', 'C'].includes(doc.rawBillStatus ?? '') || doc.rawAllocationStatus === 'voided')) return false
  if (completed) return documents.every(doc => doc.rawBillStatus === 'C')
  if (!['0', '1'].includes(order.sourceOutboundStatus ?? '')) return false
  const pending = documents.filter(doc => doc.rawBillStatus === 'A' || doc.rawBillStatus === 'B')
  if (!pending.length) return false
  return queue === 'allocation_review'
    ? pending.every(doc => doc.rawAllocationStatus === 'completed')
    : pending.every(doc => ['pending', 'available', 'completed'].includes(doc.rawAllocationStatus ?? ''))
      && pending.some(doc => doc.rawAllocationStatus === 'pending' || doc.rawAllocationStatus === 'available')
}
