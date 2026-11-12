/** Read-only projection audit, never an authorization grant or a business-state mutation.
 * Membership is necessary but not sufficient for endpoint visibility: live authorization,
 * linked-document predicates and whole-list completeness are checked by LocalWorkbenchService.
 * Synthetic tuples do not prove that a normal FOP workflow can reach those states.
 * Current FOP creates allocation after order audit and rejects incomplete allocation audit.
 * Missing allocation / approved-but-incomplete reasons are consistency-investigation clues,
 * not proof of normal process gaps. Future pre-allocation queues need a separate contract.
 */
export const REGULAR_PENDING_QUEUES = ['unpaid','review','dispatch','procurement','procurement_shipping','allocation','allocation_review','shipping'] as const
export const SUPPLEMENTARY_QUEUES = ['rma','exceptions','purchase_returns'] as const
export interface CoverageEvidence {
  cancelled: boolean | null
  rawDeliveryStatus: string | null
  ready: boolean
  memberships: Record<string, string | undefined>
  allocationCreated?: boolean | null
  stockReadiness?: string
  allocationReview?: string
  intercepted?: boolean
  refunded?: boolean
}
export function diagnoseCoverage(row: CoverageEvidence) {
  const codes = [...REGULAR_PENDING_QUEUES, ...SUPPLEMENTARY_QUEUES]
  const queues = codes.filter(queue => row.memberships[queue] === 'member')
  const unknownQueues = codes.filter(queue => !['member','non_member'].includes(row.memberships[queue] ?? ''))
  const regularGap = REGULAR_PENDING_QUEUES.every(queue => row.memberships[queue] === 'non_member')
  const reasons: string[] = []
  if (row.allocationCreated === false) reasons.push('allocation_not_created')
  if (row.allocationReview === 'approved' && row.stockReadiness === 'incomplete') reasons.push('approved_allocation_stock_incomplete')
  if (row.intercepted) reasons.push('shipment_intercepted')
  if (row.refunded) reasons.push('refund_obligation_unresolved')
  const state = !row.ready ? 'unknown'
    : row.cancelled === true ? 'terminal'
    : row.rawDeliveryStatus === '2' ? 'completed'
    : row.cancelled !== false || !['0','1'].includes(row.rawDeliveryStatus ?? '') ? 'unknown'
    : queues.length ? 'potentially_actionable'
    : unknownQueues.length ? 'unknown' : 'uncovered'
  return { state, regularGap, queues, unknownQueues, reasons }
}
