import { createHash } from 'crypto'
import { normalizeTimestampProjectionRaw } from '../workbench-replica/timestamp-projection-normalizer'
import { FopPermissionDeniedError, type FopIdentity } from './fop-data.types'
import { approvalEntity, approvalVersion, type ApprovalCommand, type ApprovalOutcome, type ApprovalQueue, type ApprovalTarget } from './fop-approval.types'
import type { FopRealtimeApprovalContext, FopRealtimeScope } from './fop-realtime.types'

type Row = Record<string, any>
type Transport = (key: string, body: unknown, mutate?: boolean, idempotencyKey?: string) => Promise<unknown>
const obj = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid FOP approval response'); return v as Row }
const str = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new Error('Missing FOP approval fact'); return v }
const rows = (v: unknown): Row[] => { if (!Array.isArray(v)) throw new Error('Missing FOP approval rows'); return v.map(obj) }
const outcome = (status: ApprovalOutcome['status'], message: string, warning: string | null = null): ApprovalOutcome => ({ status, message, warning })

/** Adapter for the API contracts actually published in the test environment.
 * All reads are bounded and authenticated. No local snapshot can authorize an audit.
 * The platform audit operation owns its transaction and business validators.
 */
export class KingdeeNativeApprovalAdapter {
  constructor(private readonly organizations: readonly string[], private readonly organizationNumber: string, private readonly call: Transport) {}

  private subject(raw: Row, identity: Readonly<FopIdentity>) {
    if (raw.subject?.tenantId !== identity.tenantId || raw.subject?.userId !== identity.userId) throw new FopPermissionDeniedError('Approval identity changed')
  }
  private query(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, queue: ApprovalQueue) {
    if (!scope.actorAccountId || !scope.employeeFilter.version || !['admin', 'salesperson', 'department_manager'].includes(scope.business.role)) throw new FopPermissionDeniedError('Missing current approval scope')
    return { ...identity, organizationIds: [...this.organizations], scopeRole: scope.business.role,
      employeeId: scope.business.employeeId, departmentIds: scope.business.departmentId ? [scope.business.departmentId] : [], queue, page: 1, pageSize: 1 }
  }
  private async sourcePage(identity: Readonly<FopIdentity>, orderId: string, queue: ApprovalQueue) {
    const result = obj(await this.call('FOP_APPROVAL_ORDER_LIST_URL', { data: { org_number: this.organizationNumber, id: [orderId] }, pageNo: 1, pageSize: 1 }))
    const source = rows(result.rows)
    if (Number(result.totalCount) !== 1 || source.length !== 1 || source[0].id !== orderId) throw new FopPermissionDeniedError('Order no longer visible')
    const company = str(source[0].org_id)
    if (!this.organizations.includes(company) || source[0].hzkj_org_id != null && source[0].hzkj_org_id !== company) throw new FopPermissionDeniedError('Order company mismatch')
    const order = normalizeTimestampProjectionRaw('hzkj_orders', source[0], company)
    const page: Row = { subject: { ...identity }, organizationIds: [company], workbenchFactsSchemaVersion: 1, items: [order], facts: { allocations: [], dispatches: [] } }
    if (queue === 'allocation_review') {
      // Exact order filter plus bounded pagination; never replace missing facts with a local snapshot.
      const read = async (key: string, entity: string) => {
        const records: Row[] = [], seen = new Set<string>()
        for (let pageNo = 1; pageNo <= 20; pageNo++) {
          const response = obj(await this.call(key, { data: { org_number: this.organizationNumber, hzkj_order_no: order.billno,
            start_modifytime: '2000-01-01 00:00:00', end_modifytime: '2100-01-01 00:00:00' }, pageNo, pageSize: 100 }))
          const entries = rows(response.rows)
          if (response.pageNo !== pageNo || typeof response.lastPage !== 'boolean' || !Number.isInteger(response.totalCount)) throw new Error('Invalid approval pagination')
          for (const entry of entries) {
            if (entry.org_id !== company || entry.hzkj_order_no !== order.billno || seen.has(entry.id)) throw new Error('Unrelated approval fact')
            seen.add(entry.id); records.push(normalizeTimestampProjectionRaw(entity, entry, company))
          }
          if (response.lastPage) { if (records.length !== response.totalCount) throw new Error('Incomplete approval facts'); return records }
          if (!entries.length) throw new Error('Incomplete approval facts')
        }
        throw new Error('Approval fact page limit exceeded')
      }
      ;[page.facts.allocations, page.facts.dispatches] = await Promise.all([
        read('FOP_APPROVAL_ALLOCATION_LIST_URL', 'hzkj_alloc_bill'), read('FOP_APPROVAL_DISPATCH_LIST_URL', 'hzkj_deliver_bill'),
      ])
    }
    return page
  }
  async context(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, queue: ApprovalQueue, orderId: string): Promise<FopRealtimeApprovalContext> {
    if (!/^[1-9]\d{0,18}$/.test(orderId) || !['review', 'allocation_review'].includes(queue)) throw new FopPermissionDeniedError('Invalid approval target')
    const query = this.query(identity, scope, queue)
    // Independent read-only proofs run together; both are validated before any audit.
    const [grantResponse, pageResponse] = await Promise.all([
      this.call('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL', { query }),
      this.sourcePage(identity, orderId, queue),
    ])
    const grant = obj(grantResponse)
    this.subject(grant, identity)
    if (queue === 'allocation_review' && !grant.approvalActions?.includes(queue)) throw new FopPermissionDeniedError('Allocation audit permission denied')
    const page = obj(pageResponse)
    this.subject(page, identity)
    const source = rows(page.items)
    if (page.workbenchFactsSchemaVersion !== 1 || source.length !== 1 || source[0].id !== orderId) throw new FopPermissionDeniedError('Order no longer visible')
    const order = source[0], company = str(order.hzkj_org?.id), owner = str(order.hzkj_operator?.id)
    if (!this.organizations.includes(company) || !page.organizationIds?.includes(company) || !grant.grants?.orders?.includes(company)
      || scope.employeeFilter.employeeIds !== null && !scope.employeeFilter.employeeIds.includes(owner)
      || scope.business.role === 'salesperson' && owner !== scope.business.employeeId
      || order.hzkj_billtype?.number !== 'hzkj_orders_BT') throw new FopPermissionDeniedError('Order outside current company or employee scope')
    const number = str(order.billno), active = order.hzkj_use_status === '1'
    let target: ApprovalTarget
    let allocationDocument: FopRealtimeApprovalContext['order']['allocationDocument'] = null
    let dispatchDocuments: FopRealtimeApprovalContext['order']['dispatchDocuments'] = null
    let inQueue = false
    if (queue === 'review') {
      const d = order
      if (!['A', 'B', 'C'].includes(d.billstatus)) throw new Error('Unsupported document status')
      str(d.modifytime)
      inQueue = active && d.hzkj_receipt_status === '1' && d.hzkj_orderstatus === '2' && ['A', 'B'].includes(d.billstatus)
      target = { tenantId: identity.tenantId, orderId, id: orderId, number, entity: approvalEntity(queue), status: d.billstatus,
        version: createHash('sha256').update(JSON.stringify(d)).digest('hex'), eligible: inQueue && d.billstatus === 'B',
        reason: d.billstatus === 'A' ? '请先在 FOP 提交履约订单' : !inQueue && d.billstatus !== 'C' ? '订单须已支付且处于待审核状态' : null }
    } else {
      const facts = obj(page.facts)
      const allocations = rows(facts.allocations).filter(a => a.hzkj_order_id === orderId && a.hzkj_alloc_status !== 'voided')
      if (allocations.length !== 1 || allocations[0].organizationId !== company || allocations[0].hzkj_order_no !== number) throw new Error('Allocation must belong to exactly one order')
      const a = allocations[0]
      allocationDocument = { id: str(a.id), number: str(a.billno) }
      dispatchDocuments = rows(facts.dispatches).filter(d => d.hzkj_order_no === number && d.organizationId === company && d.hzkj_ship_block_state !== 'CANCELLED')
        .map(d => ({ id: str(d.id), number: str(d.billno), status: d.billstatus === 'C' ? 'approved' as const : d.billstatus === 'B' ? 'submitted' as const : d.billstatus === 'A' ? 'draft' as const : 'unknown' as const }))
      if (a.billstatus === 'C') {
        target = { tenantId: identity.tenantId, orderId, id: a.id, number: a.billno, entity: approvalEntity(queue), version: createHash('sha256').update(JSON.stringify(a)).digest('hex'), status: 'C', eligible: false, reason: null }
      } else {
      const response = obj(await this.call('FOP_KINGDEE_ALLOCATION_TARGETS_URL', { query: { ...query, orderIds: [orderId] } }))
      this.subject(response, identity)
      const targets = rows(response.items)
      if (targets.length !== 1) throw new Error('Allocation target missing or ambiguous')
      const t = targets[0]
      if (t.id !== a.id || t.number !== a.billno || t.orderId !== orderId || t.tenantId !== identity.tenantId || t.entity !== approvalEntity(queue)
        || !['A', 'B', 'C'].includes(t.status) || t.status !== a.billstatus || typeof t.eligible !== 'boolean') throw new Error('Allocation changed during precheck')
      inQueue = active && order.billstatus === 'C' && a.hzkj_alloc_status === 'completed' && a.billstatus !== 'C'
      const complete = dispatchDocuments.length > 0 && dispatchDocuments.every(d => d.status === 'approved')
      target = { tenantId: identity.tenantId, orderId, id: t.id, number: t.number, entity: t.entity, version: str(t.version), status: t.status,
        eligible: inQueue && complete && t.status === 'B' && t.eligible, reason: t.reason ?? (!complete ? '请先完成对应发运单审核' : null) }
      }
    }
    return { identity: { ...identity }, currentScope: scope, inQueue, targets: [target], sourcePage: page, order: { id: orderId, orderNumber: number, allocationDocument, dispatchDocuments } }
  }

  async approve(identity: Readonly<FopIdentity>, command: ApprovalCommand): Promise<ApprovalOutcome> {
    if (!command.currentScope || command.actorAccountId !== command.currentScope.actorAccountId || command.tenantId !== identity.tenantId
      || command.operation !== 'audit' || command.status !== 'B' || command.eligible !== true || !/^[a-f0-9]{64}$/.test(command.idempotencyKey)
      || !['hzkj_orders', 'hzkj_alloc_bill'].includes(command.entity)) throw new FopPermissionDeniedError('Invalid audit command')
    const queue = command.entity === 'hzkj_orders' ? 'review' : 'allocation_review'
    const current = await this.context(identity, command.currentScope, queue, command.orderId)
    if (current.targets[0].status === 'C') return outcome('already_approved', '单据已审核，无需重复操作')
    if (!current.inQueue || !current.targets[0].eligible || current.targets[0].number !== command.number || approvalVersion(current.targets) !== approvalVersion([command])) return outcome('blocked', '单据或审核条件已变化，请刷新核对')
    let receipt: Row
    try {
      receipt = obj(await this.call(queue === 'review' ? 'FOP_KINGDEE_FULFILLMENT_AUDIT_URL' : 'FOP_KINGDEE_ALLOCATION_AUDIT_URL',
        queue === 'review' ? { data: { billno: command.number, org_number: this.organizationNumber } }
          : { query: { ...this.query(identity, command.currentScope, queue), orderIds: [command.orderId] }, command }, true, command.idempotencyKey))
    } catch (error) {
      if (error instanceof FopPermissionDeniedError) throw error
      return outcome('unknown', '审核响应未确认，请在 FOP 核对，勿重复提交')
    }
    if (queue === 'allocation_review') {
      if (!['approved', 'already_approved', 'blocked', 'failed', 'unknown'].includes(receipt.status) || typeof receipt.message !== 'string') return outcome('unknown', '配货审核回执未确认，请在 FOP 核对')
      if (['blocked', 'failed', 'unknown'].includes(receipt.status)) return outcome(receipt.status, receipt.message.slice(0, 1000), typeof receipt.warning === 'string' ? receipt.warning.slice(0, 1000) : null)
    }
    if (queue === 'review') {
      const r = Array.isArray(receipt.result) && receipt.result.length === 1 ? obj(receipt.result[0]) : null
      if (!r || r.id !== command.id || r.number !== command.number || Number(receipt.totalCount) !== 1) return outcome('unknown', '审核回执与目标不一致，请在 FOP 核对')
      if (r.billStatus === false && Number(receipt.failCount) === 1 && Number(receipt.successCount) === 0) return outcome('failed', receipt.operationMessage || (Array.isArray(r.errors) ? r.errors.map((e: any) => typeof e === 'string' ? e : e.message ?? e.msg ?? '').filter(Boolean).join('；') : '')?.slice(0, 1000) || 'FOP 校验未通过，请在 FOP 查看原因')
      if (receipt.operationStatus === false || r.billStatus !== true || Number(receipt.successCount) !== 1 || Number(receipt.failCount) !== 0) return outcome('unknown', '审核回执未确认，请在 FOP 核对')
    }
    // Read-back is mandatory even for a nominal success. No local success is synthesized.
    try {
      const checked = await this.context(identity, command.currentScope, queue, command.orderId)
      if (checked.targets[0].id === command.id && checked.targets[0].number === command.number && checked.targets[0].status === 'C') return {
        ...outcome('approved', 'FOP 已审核，已回读确认', typeof receipt.warning === 'string' ? receipt.warning.slice(0, 1000) : null),
        readback: { tenantId: identity.tenantId, companyId: checked.sourcePage!.items[0].hzkj_org.id, orderId: command.orderId, entity: command.entity, documentId: command.id, capturedAt: new Date().toISOString(), page: checked.sourcePage! },
      }
    } catch { /* Source may become invisible after audit; keep the outcome unconfirmed. */ }
    return outcome('unknown', '审核后状态尚未确认，请在 FOP 核对，勿重复提交')
  }
}
