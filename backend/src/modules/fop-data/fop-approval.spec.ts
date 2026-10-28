import { FopApprovalService } from './fop-approval.service'
import { approvalVersion } from './fop-approval.types'

describe('workbench approval', () => {
  const identity = { tenantId: 't', userId: 'u' }
  const order = { id: 'o', orderNumber: 'ORDER', allocationDocument: { id: 'd', number: 'AO261028000404' }, dispatchDocuments: [{ id: 'fy', number: 'FY', status: 'approved' }] }
  const doc = { tenantId: 't', orderId: 'o', id: 'd', number: 'AO261028000404', entity: 'hzkj_alloc_bill', version: 'v1', status: 'B' as const, eligible: true, reason: null }
  let provider: any, data: any, service: FopApprovalService
  beforeEach(() => {
    data = { approvalContext: jest.fn().mockResolvedValue({ identity, order, inQueue: true }) }
    provider = { source: 'fop', approvalTargets: jest.fn().mockResolvedValue([doc]), approveDocument: jest.fn().mockResolvedValue({ status: 'approved', message: '已审核', warning: null }) }
    service = new FopApprovalService(data, provider)
  })
  const request = () => ({ queue: 'allocation_review' as const, requestId: '12345678-1234-4234-8234-123456789abc', items: [{ orderId: 'o', version: approvalVersion([doc]) }] })
  it('blocks unfinished dispatches even if the upstream target claims eligibility', async () => {
    data.approvalContext.mockResolvedValue({ identity, order: { ...order, dispatchDocuments: [] }, inQueue: true })
    const preview = await service.preview('account', { queue: 'allocation_review', orderIds: ['o'] })
    expect(preview.items[0].eligible).toBe(false)
    const result = await service.submit('account', { ...request(), items: [{ orderId: 'o', version: preview.items[0].version }] })
    expect(result.items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('keeps blocked rows visible while approving only dispatch-complete allocations in a mixed batch', async () => {
    data.approvalContext.mockImplementation(async (_actor: string, _queue: string, id: string) => ({ identity, order: { ...order, id, allocationDocument: { id: `doc-${id}`, number: doc.number }, dispatchDocuments: id === 'o' ? order.dispatchDocuments : [] }, inQueue: true }))
    provider.approvalTargets.mockImplementation(async (_identity: unknown, _queue: string, id: string) => [{ ...doc, orderId: id, id: `doc-${id}` }])
    const preview = await service.preview('account', { queue: 'allocation_review', orderIds: ['o', 'waiting'] })
    expect(preview.items.map(row => row.eligible)).toEqual([true, false])
    const result = await service.submit('account', { ...request(), items: preview.items.map(({ orderId, version }) => ({ orderId, version })) })
    expect(result.items.map(row => row.status)).toEqual(['approved', 'blocked'])
    expect(provider.approveDocument).toHaveBeenCalledTimes(1)
    expect(provider.approveDocument.mock.calls[0][1].orderId).toBe('o')
  })
  it('rechecks completed dispatches before every allocation write', async () => {
    data.approvalContext.mockResolvedValueOnce({ identity, order, inQueue: true }).mockResolvedValueOnce({ identity, order, inQueue: true })
      .mockResolvedValue({ identity, order: { ...order, dispatchDocuments: [{ id: 'fy', number: 'FY', status: 'draft' }] }, inQueue: true })
    expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
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
  it('rejects multiple allocation targets for one order without auditing either', async () => {
    const targets = [doc, { ...doc, id: 'd2', number: 'AO261028000405' }]
    provider.approvalTargets.mockResolvedValue(targets)
    await expect(service.preview('account', { queue: 'allocation_review', orderIds: ['o'] })).rejects.toMatchObject({ status: 503 })
    const query = request(); query.items[0].version = approvalVersion(targets)
    expect((await service.submit('account', query)).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it.each([null, { id: 'other', number: doc.number }, { id: doc.id, number: 'AO261028000999' }])('blocks absent or mismatched allocation reference %j', async allocationDocument => {
    data.approvalContext.mockResolvedValue({ identity, order: { ...order, allocationDocument }, inQueue: true })
    expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('rechecks the unique allocation reference immediately before audit', async () => {
    data.approvalContext.mockResolvedValueOnce({ identity, order, inQueue: true }).mockResolvedValueOnce({ identity, order, inQueue: true })
      .mockResolvedValue({ identity, order: { ...order, allocationDocument: { id: 'replacement', number: 'AO261028000999' } }, inQueue: true })
    expect((await service.submit('account', request())).items[0].status).toBe('blocked')
    expect(provider.approveDocument).not.toHaveBeenCalled()
  })
  it('preserves separate allocation outcomes for a batch of different orders', async () => {
    const other = { ...doc, orderId: 'o2', id: 'd2', number: 'AO261028000405' }
    data.approvalContext.mockImplementation(async (_actor: string, _queue: string, id: string) => ({ identity, order: { ...order, id, allocationDocument: id === 'o' ? order.allocationDocument : { id: other.id, number: other.number } }, inQueue: true }))
    provider.approvalTargets.mockImplementation(async (_identity: unknown, _queue: string, id: string) => [id === 'o' ? doc : other])
    provider.approveDocument.mockResolvedValueOnce({ status: 'approved', message: 'approved', warning: null }).mockResolvedValueOnce({ status: 'failed', message: 'stock changed', warning: null })
    const query = request(); query.items.push({ orderId: 'o2', version: approvalVersion([other]) })
    const rows = (await service.submit('account', query)).items
    expect(rows.map(r => r.status)).toEqual(['approved', 'failed'])
    expect(rows.map(r => r.documents.length)).toEqual([1, 1])
    expect(provider.approveDocument.mock.calls.map((call: any[]) => call[1].id)).toEqual(['d', 'd2'])
  })
  it('uses a stable key for same actor, request and document', async () => {
    await service.submit('account', request()); await service.submit('account', request())
    expect(provider.approveDocument.mock.calls[0][1].idempotencyKey).toBe(provider.approveDocument.mock.calls[1][1].idempotencyKey)
  })
})
