import { getDispatchTaskStatus, getDispatchCompletionStatus } from './workbench-status'
import type { FulfillmentOrderFiltersDto, FulfillmentSortBy } from '../users/dto/workbench.dto'
import type { FopOrder } from './fop-data.types'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { normalizeConsumerPaidAt } from './consumer-payment-time'

const statusQueues: Record<Exclude<FulfillmentSortBy, 'paidAt'>, readonly FulfillmentOrderFiltersDto['queue'][]> = {
  reviewedAt: ['procurement'],
  consumerPaidAt: ['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'],
  dispatchDocumentStatus: ['dispatch', 'allocation', 'allocation_review'],
  allocationDocumentStatus: ['allocation', 'allocation_review', 'shipping'],
  stockReadiness: ['allocation', 'allocation_review'],
  allocationReviewStatus: ['allocation', 'allocation_review'],
  outboundStatus: ['shipping'],
}

export function canSortFulfillmentQueue(queue: FulfillmentOrderFiltersDto['queue'], field: FulfillmentSortBy): boolean {
  return field === 'paidAt' || !!statusQueues[field]?.includes(queue)
}

// Unknown dates stay last in either direction; never substitute the creation date.
export function paymentTime(order: FopOrder): number {
  const timestamp = order.paidAt ? Date.parse(order.paidAt) : NaN
  return Number.isFinite(timestamp) ? timestamp : Infinity
}

function compareKnown(a: number, b: number, direction: 'asc' | 'desc'): number {
  if (a === b) return 0
  if (a === Infinity) return 1
  if (b === Infinity) return -1
  return direction === 'desc' ? b - a : a - b
}

export function comparePaymentTime(left: FopOrder, right: FopOrder, direction: 'asc' | 'desc' = 'asc'): number {
  return compareKnown(paymentTime(left), paymentTime(right), direction) || left.id.localeCompare(right.id)
}

function statusRank(order: FopOrder, field: Exclude<FulfillmentSortBy, 'paidAt' | 'consumerPaidAt' | 'reviewedAt'>): number {
  if (field === 'dispatchDocumentStatus') {
    const ranks: Record<string, number> = { dispatch_missing: 0, dispatch_draft: 1, dispatch_submitted: 2, dispatch_approved: 3, dispatch_synced: 4 }
    return ranks[getDispatchTaskStatus(order.dispatchDocuments, order.fulfillmentProgress.shopifySync)] ?? Infinity
  }
  const progress = order.fulfillmentProgress
  if (field === 'stockReadiness') return ({ incomplete: 0, ready: 1, unknown: Infinity })[progress.stockReadiness]
  if (field === 'allocationReviewStatus') return ({ pending: 0, approved: 1, unknown: Infinity })[progress.allocationReview]
  if (field === 'allocationDocumentStatus') {
    if (progress.stockReadiness === 'incomplete') return 0
    if (progress.stockReadiness === 'ready') {
      if (progress.allocationReview === 'pending') return 1
      if (progress.allocationReview === 'approved') return 2
    }
    return Infinity
  }
  // Match the warehouse column: approval pending precedes outbound work.
  if (progress.allocationReview === 'pending') return 0
  return ({ pending: 1, partial: 2, completed: 3, unknown: Infinity })[progress.outbound]
}

export function compareFulfillmentOrders(left: FopOrder, right: FopOrder, query: FulfillmentOrderFiltersDto): number {
  const field = query.sortBy ?? 'paidAt'
  if (field === 'paidAt') return comparePaymentTime(left, right, query.sortOrder ?? query.paidAtOrder ?? 'asc')
  if (field === 'consumerPaidAt' || field === 'reviewedAt') {
    const leftTime = field === 'reviewedAt' ? normalizeBusinessTimestamp(left.reviewedAt) : normalizeConsumerPaidAt(left.consumerPaidAt)
    const rightTime = field === 'reviewedAt' ? normalizeBusinessTimestamp(right.reviewedAt) : normalizeConsumerPaidAt(right.consumerPaidAt)
    return compareKnown(leftTime ? Date.parse(leftTime) : Infinity, rightTime ? Date.parse(rightTime) : Infinity, query.sortOrder ?? 'asc')
      || comparePaymentTime(left, right)
  }
  if (field === 'dispatchDocumentStatus' && query.queue === 'allocation_review') {
    return compareKnown(getDispatchCompletionStatus(left.dispatchDocuments) === 'dispatch_complete' ? 1 : 0,
      getDispatchCompletionStatus(right.dispatchDocuments) === 'dispatch_complete' ? 1 : 0, query.sortOrder ?? 'asc') || comparePaymentTime(left, right)
  }
  return compareKnown(statusRank(left, field), statusRank(right, field), query.sortOrder ?? 'asc')
    || comparePaymentTime(left, right)
}
