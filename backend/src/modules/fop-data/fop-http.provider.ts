import type { AllocationInventoryScope, AllocationInventorySnapshot } from './allocation-inventory'
import { FopDataProvider, FopIdentity, FopPermissionGrant, FopOrderCandidate, FopPermissionDeniedError } from './fop-data.types'
import { ApprovalCommand, ApprovalOutcome, ApprovalQueue, ApprovalTarget } from './fop-approval.types'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
/** HyperZone employee gateway contract, not a fabricated Kingdee standard API.
 * Gateway must enforce delegated-user permissions, audit plugins and durable idempotency atomically.
 */
export class HttpFopDataProvider extends FopDataProvider {
  getAllocationInventory(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, scopes: readonly AllocationInventoryScope[]) { return this.call<AllocationInventorySnapshot & { subject: FopIdentity }>('/allocation-inventory', identity, { scopeIds: scopes.map(s => s.id) }) }
  private readonly base = process.env.FOP_EMPLOYEE_API_URL?.replace(/\/$/, '')
  private readonly token = process.env.FOP_EMPLOYEE_API_TOKEN
  isConfigured() { return !!this.base && !!this.token && /^https:\/\//.test(this.base) }
  private async call<T>(path: string, identity: Readonly<FopIdentity>, body: object): Promise<T> {
    if (!this.isConfigured()) throw new Error('FOP employee API is not configured')
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ ...body, subject: { tenantId: identity.tenantId, userId: identity.userId } }),
    })
    if (response.status === 403) throw new FopPermissionDeniedError('FOP action denied')
    if (!response.ok) throw new Error('FOP employee API request failed')
    return response.json() as Promise<T>
  }
  resolvePermissions(identity: Readonly<FopIdentity>): Promise<FopPermissionGrant> { return this.call('/permissions', identity, {}) }
  listOrders(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopOrderCandidate[]> { return this.call('/fulfillment-orders', identity, {}) }
  listStockOrders(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopStockOrderCandidate[]> { return this.call('/stock-orders', identity, {}) }
  listStockInventory(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopStockInventoryCandidate[]> { return this.call('/stock-inventory', identity, {}) }
  approvalTargets(identity: Readonly<FopIdentity>, queue: ApprovalQueue, orderId: string): Promise<ApprovalTarget[]> { return this.call('/approvals/targets', identity, { queue, orderId }) }
  approveDocument(identity: Readonly<FopIdentity>, command: ApprovalCommand): Promise<ApprovalOutcome> { return this.call('/approvals/audit', identity, { command }) }
}
