import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'crypto'
import { FOP_DATA_PROVIDER, FopDataProvider, FopPermissionDeniedError } from './fop-data.types'
import { FopDataService } from './fop-data.service'
import { ApprovalPreviewDto, ApprovalSubmitDto } from './fop-approval.dto'
import { ApprovalQueue, ApprovalTarget, ApprovalRowResult, approvalEntity, approvalVersion } from './fop-approval.types'
import { getDispatchCompletionStatus } from './workbench-status'

@Injectable()
export class FopApprovalService {
  constructor(private readonly data: FopDataService, @Inject(FOP_DATA_PROVIDER) private readonly provider: FopDataProvider) {}
  private async targets(userId: string, queue: ApprovalQueue, orderId: string, sessionVersion: number) {
    const context = await this.data.approvalContext(userId, queue, orderId, sessionVersion)
    let targets: ApprovalTarget[]
    try { targets = await this.provider.approvalTargets(context.identity, queue, orderId) }
    catch (error) {
      if (error instanceof FopPermissionDeniedError) throw new ForbiddenException('FOP审核权限不足')
      throw new ServiceUnavailableException('FOP审核接口暂不可用或尚未配置')
    }
    const latest = await this.data.approvalContext(userId, queue, orderId, sessionVersion)
    if (JSON.stringify(latest.identity) !== JSON.stringify(context.identity)) throw new ServiceUnavailableException('审核身份已变化，请重新查询')
    const validText = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 500
    if (!Array.isArray(targets) || targets.length !== 1 || new Set(targets.map(d => d?.id)).size !== targets.length
      || queue === 'review' && (targets.length !== 1 || targets[0].id !== orderId)
      || targets.some(d => !d || d.tenantId !== context.identity.tenantId || d.orderId !== orderId || d.entity !== approvalEntity(queue)
        || !validText(d.id) || !validText(d.number) || !validText(d.version) || !['A', 'B', 'C'].includes(d.status) || typeof d.eligible !== 'boolean'
        || (d.reason !== null && !validText(d.reason)))) throw new ServiceUnavailableException('无法确认关联审核单据，请刷新或联系管理员')
    if (queue === 'allocation_review' && (!latest.order.allocationDocument
      || targets[0].id !== latest.order.allocationDocument.id || targets[0].number !== latest.order.allocationDocument.number)) {
      throw new ServiceUnavailableException('Cannot confirm the unique allocation document')
    }
    const dispatchComplete = queue !== 'allocation_review' || getDispatchCompletionStatus(latest.order.dispatchDocuments) === 'dispatch_complete'
    return { ...latest, targets: dispatchComplete ? targets : targets.map(target => ({ ...target, eligible: false, reason: '请先完成发运单制作' })) }
  }
  async preview(userId: string, query: ApprovalPreviewDto, sessionVersion = 0) {
    if (!['review', 'allocation_review'].includes(query.queue)) throw new BadRequestException('Invalid approval queue')
    const started = Date.now()
    const items = []
    for (const orderId of query.orderIds) {
      if (Date.now() - started > 30000) throw new ServiceUnavailableException('FOP 响应较慢，请减少每批订单数')
      const { order, targets, inQueue } = await this.targets(userId, query.queue, orderId, sessionVersion)
      const documents = targets.map(d => ({ id: d.id, number: d.number, status: d.status, eligible: inQueue && d.status === 'B' && d.eligible, reason: d.status === 'C' ? '已审核' : d.reason || (d.status !== 'B' ? '单据尚未提交，请先在 FOP 完成提交' : !inQueue ? '订单已离开当前待审核清单' : null) }))
      items.push({ orderId, orderNumber: order.orderNumber, version: approvalVersion(targets), eligible: documents.some(d => d.eligible), documents })
    }
    return { source: this.provider.source ?? 'fop', queue: query.queue, items }
  }
  async submit(userId: string, query: ApprovalSubmitDto, sessionVersion = 0) {
    if (!['review', 'allocation_review'].includes(query.queue)) throw new BadRequestException('Invalid approval queue')
    const started = Date.now()
    const items: ApprovalRowResult[] = []
    for (const selected of query.items) {
      let attemptedTargets: ApprovalTarget[] = []
      const row: ApprovalRowResult = { orderId: selected.orderId, orderNumber: '', status: 'blocked', message: '', documents: [] }
      try {
        if (Date.now() - started > 30000) throw new Error('Batch time budget exceeded; not submitted')
        const context = await this.targets(userId, query.queue, selected.orderId, sessionVersion)
        row.orderNumber = context.order.orderNumber
        if (context.targets.every(d => d.status === 'C')) {
          row.status = 'already_approved'; row.message = '单据已审核，无需重复操作'
        } else if (!context.inQueue || approvalVersion(context.targets) !== selected.version) {
          row.message = '单据或状态已变化，请重新选择并核对'
        } else {
          attemptedTargets = context.targets
          for (const document of context.targets) {
            if (Date.now() - started > 30000) throw new Error('Batch time budget exceeded; remaining documents not submitted')
            if (document.status === 'C') { row.documents.push({ id: document.id, number: document.number, status: 'already_approved', message: '已审核', warning: null }); continue }
            if (!document.eligible || document.status !== 'B') { row.documents.push({ id: document.id, number: document.number, status: 'blocked', message: document.reason || '单据不满足审核条件，请在 FOP 核对', warning: null }); continue }
            // Recheck account scope/action grant before each write. FOP must atomically recheck document state and delegated-user permissions.
            const current = await this.data.approvalContext(userId, query.queue, selected.orderId, sessionVersion)
            if (!current.inQueue || JSON.stringify(current.identity) !== JSON.stringify(context.identity)
              || query.queue === 'allocation_review' && (getDispatchCompletionStatus(current.order.dispatchDocuments) !== 'dispatch_complete'
                || current.order.allocationDocument?.id !== document.id || current.order.allocationDocument?.number !== document.number)) throw new Error('Scope or dispatch state changed')
            const idempotencyKey = createHash('sha256').update(JSON.stringify([context.identity, userId, query.requestId, document.entity, document.id])).digest('hex')
            try {
              const outcome = await this.provider.approveDocument(context.identity, { ...document, operation: 'audit', idempotencyKey, requestId: query.requestId, actorAccountId: userId })
              if (!outcome || !['approved', 'already_approved', 'blocked', 'failed', 'unknown'].includes(outcome.status) || typeof outcome.message !== 'string'
                || (outcome.warning !== null && typeof outcome.warning !== 'string')) throw new Error('Invalid audit response')
              row.documents.push({ id: document.id, number: document.number, status: outcome.status, message: outcome.message.slice(0, 1000), warning: outcome.warning?.slice(0, 1000) ?? null })
            } catch (error) {
              // A transport error can occur after FOP commits. Never classify it as a failed audit or automatically retry.
              row.documents.push({ id: document.id, number: document.number, status: error instanceof FopPermissionDeniedError ? 'blocked' : 'unknown', message: error instanceof FopPermissionDeniedError ? 'FOP审核权限不足，未提交' : '审核结果尚未确认，请在 FOP 核对，勿重复提交', warning: null })
            }
            if (row.documents[row.documents.length - 1]?.status === 'unknown') break
          }
        }
      } catch { row.message = '无法审核：权限或单据状态已变化，或 FOP 暂不可用；请刷新核对' }
      for (const document of attemptedTargets) {
        if (!row.documents.some(d => d.id === document.id)) row.documents.push({ id: document.id, number: document.number, status: document.status === 'C' ? 'already_approved' : 'blocked', message: document.status === 'C' ? '已审核，无需重复操作' : '本次未提交，请核对已执行结果后重新选择', warning: null })
      }
      if (row.documents.length) {
        const success = row.documents.filter(d => ['approved', 'already_approved'].includes(d.status)).length
        row.status = row.documents.some(d => d.status === 'unknown') ? 'unknown' : row.message ? success ? 'partial' : 'blocked' : success === row.documents.length ? 'approved' : success ? 'partial' : row.documents.some(d => d.status === 'failed') ? 'failed' : 'blocked'
        row.message ||= row.status === 'approved' ? '审核完成' : row.status === 'partial' ? '部分单据审核完成，请查看逐笔结果' : row.status === 'unknown' ? '结果待核对；其余单据未继续提交' : '未完成审核，请查看原因'
      }
      items.push(row)
    }
    return { source: this.provider.source ?? 'fop', requestId: query.requestId, items, completedAt: new Date().toISOString() }
  }
}
