/** Fulfillment header is authoritative; tracking must belong to a current effective dispatch. */
export function orderDispatchTaskStatus(order: {
  businessStatus?: { order: string }
  dispatchDocuments?: readonly { number?: string | null; association?: { state?: string }; rawInterceptStatus?: string | null; deliveryStatus?: string | null; trackingNumbers?: readonly { type: string; number: string }[] | null }[] | null
  nativeAssociationIssues?: readonly string[]
}): 'dispatch_missing' | 'dispatch_pending' | 'dispatch_tracking' | 'dispatch_cancelled' | 'dispatch_synced' | 'unknown' {
  const state = order.businessStatus?.order
  if (state === 'fulfillment_cancelled') return 'dispatch_cancelled'
  if (state === 'fulfilled' || state === 'partial_fulfilled') return 'dispatch_synced'
  if (!['paid', 'processing'].includes(state ?? '') || !Array.isArray(order.dispatchDocuments)) return 'unknown'
  if (order.nativeAssociationIssues?.some(issue => ['dispatch_relationship_conflict', 'parent_version_conflict'].includes(issue))
    || order.dispatchDocuments.some(doc => doc.association && doc.association.state !== 'verified')) return 'unknown'
  const effective = order.dispatchDocuments.filter(doc => doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus !== 'CANCELLED')
  if (effective.some(doc => !Array.isArray(doc.trackingNumbers))) return 'unknown'
  const tracked = effective.some(doc => doc.trackingNumbers?.some((t: { type: string; number: string }) => t.type === 'full' && typeof t.number === 'string' && t.number.trim().length > 0))
  if (!effective.some(doc => typeof doc.number === 'string' && doc.number.trim())) return tracked ? 'unknown' : 'dispatch_missing'
  return tracked ? state === 'processing' ? 'dispatch_tracking' : 'unknown' : 'dispatch_pending'
}

/** A failure on a current verified dispatch is a dispatch exception, not a pending fulfillment task. */
export function hasDispatchSyncFailure(order: {
  reviewStatus?: string
  businessStatus?: { order: string }
  dispatchDocuments?: readonly { number?: string | null; association?: { state?: string }; rawInterceptStatus?: string | null; deliveryStatus?: string | null }[] | null
}): boolean {
  if (order.reviewStatus !== 'approved') return false
  if (order.businessStatus && !['paid','processing','partial_fulfilled','fulfilled'].includes(order.businessStatus.order)) return false
  return order.dispatchDocuments?.some(doc => (doc.association?.state ?? 'verified') === 'verified'
    && doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus === 'SYNC_FAILED') ?? false
}

export const missingObtainedTrackingReason = '已取号订单缺少物流跟踪号'
export const missingFulfilledTrackingReason = '履约订单物流跟踪号为空'
export const dispatchSyncFailureReason = '发运单审核同步失败'
type DispatchOrder = Parameters<typeof orderDispatchTaskStatus>[0] & {
  reviewStatus?: string
  dispatchTaskStatus?: string
  fulfillmentProgress?: { shopifySync?: string }
  logisticsInfo?: readonly { packageTrackingNumber?: string | null; shopifyTracking?: { type?: string; number?: string } | null }[] | null
}
/** The current fulfillment package is authoritative; a cleared number cannot reuse an old dispatch number. */
export function hasFulfilledTracking(order: DispatchOrder): boolean {
  return order.logisticsInfo?.some(group => {
    const value = 'packageTrackingNumber' in group ? group.packageTrackingNumber
      : ['full', 'first_mile', 'last_mile'].includes(group.shopifyTracking?.type ?? '') ? group.shopifyTracking?.number : null
    return typeof value === 'string' && value.trim().length > 0
  }) ?? false
}
export function hasMissingFulfilledTracking(order: DispatchOrder): boolean {
  const fulfilled = order.businessStatus ? ['fulfilled', 'partial_fulfilled'].includes(order.businessStatus.order)
    : order.dispatchTaskStatus === 'dispatch_synced' || order.fulfillmentProgress?.shopifySync === 'synced'
  return order.reviewStatus === 'approved' && fulfilled && !hasFulfilledTracking(order)
}
/** Obtained status must be backed by that same effective dispatch's full tracking number. */
export function hasMissingObtainedTracking(order: DispatchOrder): boolean {
  if (order.reviewStatus !== 'approved') return false
  if (order.businessStatus && !['paid', 'processing', 'fulfilled', 'partial_fulfilled'].includes(order.businessStatus.order)) return false
  const effective = (order.dispatchDocuments ?? []).filter(doc => (doc.association?.state ?? 'verified') === 'verified'
    && doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus !== 'CANCELLED')
  const numbers = (doc: typeof effective[number]) => Array.isArray(doc.trackingNumbers) ? doc.trackingNumbers.filter(t => typeof t.number === 'string' && t.number.trim()) : []
  if (effective.some(doc => {
    const tracking = numbers(doc)
    const obtained = doc.deliveryStatus === 'TRACKING_OBTAINED' || tracking.some(t => ['full', 'first_mile', 'last_mile'].includes(t.type))
    return obtained && !tracking.some(t => t.type === 'full')
  })) return true
  // Legacy/mock rows can carry a stage without native status. Native documents override stale cached stages.
  return !order.businessStatus && order.dispatchTaskStatus === 'dispatch_tracking' && !effective.some(doc => numbers(doc).some(t => t.type === 'full'))
}
export function hasDispatchException(order: DispatchOrder): boolean {
  return hasDispatchSyncFailure(order) || hasMissingObtainedTracking(order) || hasMissingFulfilledTracking(order)
}
