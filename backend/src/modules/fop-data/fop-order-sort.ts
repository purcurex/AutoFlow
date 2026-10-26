import type { ListFulfillmentOrdersDto, FulfillmentSortBy } from '../users/dto/workbench.dto'
import type { FopOrder } from './fop-data.types'

const statusQueues: Record<Exclude<FulfillmentSortBy, 'paidAt'>, readonly ListFulfillmentOrdersDto['queue'][]> = {
  dispatchDocumentStatus: ['dispatch', 'allocation', 'allocation_review'],
  allocationDocumentStatus: ['allocation', 'allocation_review', 'shipping'],
  outboundStatus: ['shipping'],
}

export function canSortFulfillmentQueue(queue: ListFulfillmentOrdersDto['queue'], field: FulfillmentSortBy): boolean {
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

function statusRank(order: FopOrder, field: Exclude<FulfillmentSortBy, 'paidAt'>): number {
  if (field === 'dispatchDocumentStatus') {
    const documents = order.dispatchDocuments
    // A partly unknown document list cannot prove an order's overall stage.
    if (!documents || documents.some(document => document.status === 'unknown')) return Infinity
    if (!documents.length) return 0
    const ranks = { draft: 1, submitted: 2, approved: 3, unknown: Infinity }
    return Math.min(...documents.map(document => ranks[document.status]))
  }
  const progress = order.fulfillmentProgress
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

export function compareFulfillmentOrders(left: FopOrder, right: FopOrder, query: ListFulfillmentOrdersDto): number {
  const field = query.sortBy ?? 'paidAt'
  if (field === 'paidAt') return comparePaymentTime(left, right, query.sortOrder ?? query.paidAtOrder ?? 'asc')
  return compareKnown(statusRank(left, field), statusRank(right, field), query.sortOrder ?? 'asc')
    || comparePaymentTime(left, right)
}
