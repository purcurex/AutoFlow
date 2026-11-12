import { completedAt } from './completed-orders'
import { getDispatchTaskStatus, getDispatchCompletionStatus } from './workbench-status'
import type { FulfillmentOrderFiltersDto, FulfillmentSortBy } from '../users/dto/workbench.dto'
import type { FopOrder } from './fop-data.types'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { normalizeConsumerPaidAt } from './consumer-payment-time'

const statusQueues: Record<Exclude<FulfillmentSortBy, 'paidAt'>, readonly FulfillmentOrderFiltersDto['queue'][]> = {
  completedAt: ['review', 'dispatch', 'procurement', 'allocation_review', 'shipping'],
  reviewedAt: ['procurement'],
  consumerPaidAt: ['unpaid', 'review', 'exceptions', 'dispatch', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'shipping'],
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

export function compareConsumerPaymentTime(left: Pick<FopOrder, 'id' | 'consumerPaidAt'>, right: Pick<FopOrder, 'id' | 'consumerPaidAt'>, direction: 'asc' | 'desc' = 'desc'): number {
  const a = normalizeConsumerPaidAt(left.consumerPaidAt), b = normalizeConsumerPaidAt(right.consumerPaidAt)
  return compareKnown(a ? Date.parse(a) : Infinity, b ? Date.parse(b) : Infinity, direction) || left.id.localeCompare(right.id)
}

export function fulfillmentSortField<T extends string>(query: { sortBy?: T; completed?: boolean }): T | 'completedAt' | 'consumerPaidAt' {
  return query.sortBy ?? 'consumerPaidAt'
}

function statusRank(order: FopOrder, field: Exclude<FulfillmentSortBy, 'completedAt' | 'paidAt' | 'consumerPaidAt' | 'reviewedAt'>): number {
  if (field === 'dispatchDocumentStatus') {
    const ranks: Record<string, number> = { dispatch_missing: 0, dispatch_draft: 1, dispatch_submitted: 2, dispatch_approved: 3, dispatch_pending: 1, dispatch_tracking: 2, dispatch_updating: 3, dispatch_cancelled: 4, dispatch_synced: 5 }
    return ranks[order.dispatchTaskStatus ?? getDispatchTaskStatus(order.dispatchDocuments, order.fulfillmentProgress.shopifySync)] ?? Infinity
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
  return ({ pending: 1, partial: 1, completed: 2, unknown: Infinity })[progress.outbound]
}

/** Time defaults are newest first; explicit status sorts retain ascending stages. */
export function fulfillmentSortDirection(query: { sortBy?: string; sortOrder?: 'asc' | 'desc'; paidAtOrder?: 'asc' | 'desc'; completed?: boolean }): 'asc' | 'desc' {
  if (query.sortOrder) return query.sortOrder
  if (query.completed && !query.sortBy) return 'desc'
  if (!query.sortBy || query.sortBy === 'paidAt') return query.paidAtOrder ?? 'desc'
  return ['completedAt', 'consumerPaidAt', 'reviewedAt'].includes(query.sortBy) ? 'desc' : 'asc'
}

export function compareFulfillmentOrders(left: FopOrder, right: FopOrder, query: FulfillmentOrderFiltersDto): number {
  const direction = fulfillmentSortDirection(query)
  const field = fulfillmentSortField(query)
  if (field === 'completedAt') return compareKnown(completedAt(left, query.queue) ? Date.parse(completedAt(left, query.queue)!) : Infinity, completedAt(right, query.queue) ? Date.parse(completedAt(right, query.queue)!) : Infinity, direction) || left.id.localeCompare(right.id)
  if (field === 'paidAt') return comparePaymentTime(left, right, direction)
  if (field === 'consumerPaidAt') return compareConsumerPaymentTime(left, right, direction)
  if (field === 'reviewedAt') {
    const leftTime = field === 'reviewedAt' ? normalizeBusinessTimestamp(left.reviewedAt) : normalizeConsumerPaidAt(left.consumerPaidAt)
    const rightTime = field === 'reviewedAt' ? normalizeBusinessTimestamp(right.reviewedAt) : normalizeConsumerPaidAt(right.consumerPaidAt)
    return compareKnown(leftTime ? Date.parse(leftTime) : Infinity, rightTime ? Date.parse(rightTime) : Infinity, direction)
      || comparePaymentTime(left, right)
  }
  if (field === 'dispatchDocumentStatus' && ['allocation', 'allocation_review'].includes(query.queue)) {
    return compareKnown(getDispatchCompletionStatus(left.dispatchDocuments) === 'dispatch_complete' ? 1 : 0,
      getDispatchCompletionStatus(right.dispatchDocuments) === 'dispatch_complete' ? 1 : 0, direction) || comparePaymentTime(left, right)
  }
  return compareKnown(statusRank(left, field), statusRank(right, field), direction)
    || comparePaymentTime(left, right)
}
