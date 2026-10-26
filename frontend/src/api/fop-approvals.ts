import api from '@/api'
export type ApprovalQueue = 'review' | 'allocation_review'
export interface ApprovalPreview {
  source: 'mock' | 'fop'; queue: ApprovalQueue
  items: { orderId: string; orderNumber: string; version: string; eligible: boolean; documents: { id: string; number: string; status: string; eligible: boolean; reason: string | null }[] }[]
}
export type ApprovalStatus = 'approved' | 'already_approved' | 'partial' | 'blocked' | 'failed' | 'unknown'
export interface ApprovalResult {
  source: 'mock' | 'fop'; requestId: string; completedAt: string
  items: { orderId: string; orderNumber: string; status: ApprovalStatus; message: string; documents: { id: string; number: string; status: ApprovalStatus; message: string; warning: string | null }[] }[]
}
const path = '/autoflow/integrations/fop/fulfillment-orders/approvals'
export function previewOrderApproval(queue: ApprovalQueue, orderIds: string[]): Promise<ApprovalPreview> { return api.post(`${path}/preview`, { queue, orderIds: [...orderIds] }, { timeout: 120000 }) }
export function submitOrderApproval(queue: ApprovalQueue, requestId: string, items: { orderId: string; version: string }[]): Promise<ApprovalResult> { return api.post(path, { queue, requestId, items: items.map(({ orderId, version }) => ({ orderId, version })) }, { timeout: 120000 }) }
