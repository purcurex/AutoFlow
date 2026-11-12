import { createHash } from 'crypto'
export type ApprovalQueue = 'review' | 'allocation_review'
export const approvalEntity = (queue: ApprovalQueue) => queue === 'review' ? 'hzkj_orders' : 'hzkj_alloc_bill'
export interface ApprovalTarget {
  tenantId: string; orderId: string; id: string; number: string
  entity: string; version: string; status: 'A' | 'B' | 'C'
  eligible: boolean; reason: string | null
}
export interface ApprovalCommand extends ApprovalTarget { operation: 'audit'; idempotencyKey: string; requestId: string; actorAccountId: string; currentScope?: import('./fop-realtime.types').FopRealtimeScope }
export type ApprovalStatus = 'approved' | 'already_approved' | 'blocked' | 'failed' | 'unknown'
export interface ApprovalOutcome { status: ApprovalStatus; message: string; warning: string | null }
export type ApprovalUnavailableCode = 'fop_approval_not_configured' | 'fop_queries_paused'
export interface ApprovalDocumentResult extends ApprovalOutcome { id: string; number: string; code?: ApprovalUnavailableCode }
export interface ApprovalRowResult { orderId: string; orderNumber: string; status: ApprovalStatus | 'partial'; message: string; documents: ApprovalDocumentResult[]; code?: ApprovalUnavailableCode }
export function approvalVersion(targets: ApprovalTarget[]): string {
  return createHash('sha256').update(JSON.stringify([...targets].sort((a, b) => a.id.localeCompare(b.id)).map(d => [d.entity, d.id, d.version, d.status, d.eligible]))).digest('hex')
}
