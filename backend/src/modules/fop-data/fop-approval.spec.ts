import { FopApprovalService } from './fop-approval.service'
import { approvalVersion } from './fop-approval.types'

describe('workbench approval', () => {
  const identity = { tenantId: 't', userId: 'u' }
  const order = { id: 'o', orderNumber: 'ORDER' }
  const doc = { tenantId: 't', orderId: 'o', id: 'd', number: 'ALLOC', entity: 'hzkj_alloc_bill', version: 'v1', status: 'B' as const, eligible: true, reason: null }
  let provider: any, data: any, service: FopApprovalService
  beforeEach(() => {
    data = { approvalContext: jest.fn().mockResolvedValue({ identity, order, inQueue: true }) }
    provider = { source: 'fop', approvalTargets: jest.fn().mockResolvedValue([doc]), approveDocument: jest.fn().mockResolvedValue({ status: 'approved', message: '已审核', warning: null }) }
    service = new FopApprovalService(data, provider)
  })
  const request = () => ({ queue: 'allocation_review' as const, requestId: '12345678-1234-4234-8234-123456789abc', items: [{ orderId: 'o', version: approvalVersion([doc]) }] })
  it('resolves trusted documents, commits once and preserves post-approval warnings', async () => {
    provider.approveDocument.mockResolvedValue({ status: 'approved', message: '已审核', warning: '发货通知生成失败' })
    const result = await service.submit('account', request())
    expect(result.items[0].documents[0]).toMatchObject({ status: 'approved', warning: '发货通知生成失败' })
    expect(provider.approveDocument.mock.calls[0][1]).toMatchObject({ entity: 'hzkj_alloc_bill', orderId: 'o', id: 'd', operation: 'audit' })
  })
  it('blocks stale previews before any mutation', async () => {
    provider.approvalTargets.mockResolvedValue([{ ...doc, version: 'v2' }])
    expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('does not audit cross-order or cross-tenant documents', async () => {
    for (const change of [{ orderId: 'other' }, { tenantId: 'other' }, { entity: 'hzkj_orders' }]) {
      provider.approvalTargets.mockResolvedValue([{ ...doc, ...change }])
      expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    }
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('denies missing action permission before reading targets or writing', async () => {
    data.approvalContext.mockRejectedValue(new Error('denied'))
    await expect(service.preview('account', { queue: 'allocation_review', orderIds: ['o'] })).rejects.toThrow()
    expect(provider.approvalTargets).not.toHaveBeenCalled()
  })
  it('treats transport failures as unknown, never failed or successful', async () => {
    provider.approveDocument.mockRejectedValue(new Error('timeout'))
    expect((await service.submit('account', request())).items[0].status).toBe('unknown')
    expect(provider.approveDocument).toHaveBeenCalledTimes(1)
  })
  it('rechecks scope immediately before mutation', async () => {
    data.approvalContext.mockResolvedValueOnce({ identity, order, inQueue: true }).mockResolvedValueOnce({ identity, order, inQueue: true }).mockRejectedValue(new Error('revoked'))
    expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('retains per-document partial success without rolling back or repeating the successful document', async () => {
    const other = { ...doc, id: 'd2', number: 'ALLOC-2' }
    provider.approvalTargets.mockResolvedValue([doc, other])
    provider.approveDocument.mockResolvedValueOnce({ status: 'approved', message: '已审核', warning: null }).mockResolvedValueOnce({ status: 'failed', message: '库存变化', warning: null })
    const query = request(); query.items[0].version = approvalVersion([doc, other])
    const row = (await service.submit('account', query)).items[0]
    expect(row.status).toBe('partial'); expect(row.documents.map(d => d.status)).toEqual(['approved','failed'])
    expect(provider.approveDocument).toHaveBeenCalledTimes(2)
  })
  it('stops unattempted package documents after an unknown response', async () => {
    const other = { ...doc, id: 'd2', number: 'ALLOC-2' }
    provider.approvalTargets.mockResolvedValue([doc, other]); provider.approveDocument.mockRejectedValue(new Error('timeout'))
    const query = request(); query.items[0].version = approvalVersion([doc, other])
    expect((await service.submit('account', query)).items[0].status).toBe('unknown')
    expect(provider.approveDocument).toHaveBeenCalledTimes(1)
  })
  it('preserves already-approved packages when execution stops after a timeout', async () => {
    const approved = { ...doc, id: 'd2', number: 'ALLOC-2', status: 'C' as const, eligible: false }
    provider.approvalTargets.mockResolvedValue([doc, approved]); provider.approveDocument.mockRejectedValue(new Error('timeout'))
    const query = request(); query.items[0].version = approvalVersion([doc, approved])
    expect((await service.submit('account', query)).items[0].documents.map(d => d.status)).toEqual(['unknown','already_approved'])
  })
  it('uses a stable key for same actor, request and document', async () => {
    await service.submit('account', request()); await service.submit('account', request())
    expect(provider.approveDocument.mock.calls[0][1].idempotencyKey).toBe(provider.approveDocument.mock.calls[1][1].idempotencyKey)
  })
})
