/** Fulfillment header is authoritative; tracking must belong to a current effective dispatch. */
export function orderDispatchTaskStatus(order: {
  businessStatus?: { order: string }
  dispatchDocuments?: readonly { association?: { state?: string }; rawInterceptStatus?: string | null; deliveryStatus?: string | null; trackingNumbers?: readonly { type: string; number: string }[] | null }[] | null
  nativeAssociationIssues?: readonly string[]
}): 'dispatch_pending' | 'dispatch_tracking' | 'dispatch_cancelled' | 'dispatch_synced' | 'unknown' {
  const state = order.businessStatus?.order
  if (state === 'fulfillment_cancelled') return 'dispatch_cancelled'
  if (state === 'fulfilled' || state === 'partial_fulfilled') return 'dispatch_synced'
  if (!['paid', 'processing'].includes(state ?? '') || !Array.isArray(order.dispatchDocuments)) return 'unknown'
  if (order.nativeAssociationIssues?.some(issue => ['dispatch_relationship_conflict', 'parent_version_conflict'].includes(issue))
    || order.dispatchDocuments.some(doc => doc.association && doc.association.state !== 'verified')) return 'unknown'
  const effective = order.dispatchDocuments.filter(doc => doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus !== 'CANCELLED')
  if (effective.some(doc => !Array.isArray(doc.trackingNumbers))) return 'unknown'
  const tracked = effective.some(doc => doc.trackingNumbers?.some((t: { type: string; number: string }) => ['full', 'first_mile', 'last_mile'].includes(t.type) && typeof t.number === 'string' && t.number.trim().length > 0))
  return tracked ? state === 'processing' ? 'dispatch_tracking' : 'unknown' : 'dispatch_pending'
}

/** A failure on a current verified dispatch is a dispatch exception, not a pending fulfillment task. */
export function hasDispatchSyncFailure(order: {
  reviewStatus?: string
  businessStatus?: { order: string }
  dispatchDocuments?: readonly { association?: { state?: string }; rawInterceptStatus?: string | null; deliveryStatus?: string | null }[] | null
}): boolean {
  if (order.reviewStatus !== 'approved') return false
  if (order.businessStatus && !['paid','processing','partial_fulfilled','fulfilled'].includes(order.businessStatus.order)) return false
  return order.dispatchDocuments?.some(doc => (doc.association?.state ?? 'verified') === 'verified'
    && doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus === 'SYNC_FAILED') ?? false
}
