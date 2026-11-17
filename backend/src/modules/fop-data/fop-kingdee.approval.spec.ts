import { KingdeeNativeApprovalAdapter } from './fop-kingdee.approval'

const identity = { tenantId: 'hyperzone.test', userId: '123' }
const scope: any = { actorAccountId: 'account', business: { role: 'admin' }, employeeFilter: { employeeIds: ['88'], version: 'scope1' } }
const order = { id: '1001', billno: 'TO261028036138', billstatus: 'B', hzkj_orderstatus: '2', hzkj_receipt_status: '1', hzkj_use_status: '1', hzkj_billtype: { number: 'hzkj_orders_BT' }, hzkj_org: { id: '100000' }, hzkj_operator: { id: '88' } }
function setup(change: any = {}) {
  const current = { ...order, ...change }
  const call = jest.fn(async (key: string, _body?: unknown, _mutate?: boolean, _key?: string): Promise<any> => {
    if (key === 'FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL') return { subject: identity, grants: { orders: ['100000'] }, approvalActions: ['allocation_review'] }
    if (key === 'FOP_KINGDEE_QUERY_URL') return { subject: identity, organizationIds: ['100000'], workbenchFactsSchemaVersion: 1, items: [current], facts: { allocations: [], dispatches: [] } }
    if (key === 'FOP_KINGDEE_ORDER_DETAIL_URL') return { totalCount: 1, rows: [{ ...current, modifytime: '2026-11-16 10:00:00' }] }
    if (key === 'FOP_KINGDEE_FULFILLMENT_AUDIT_URL') { current.billstatus = 'C'; return { successCount: '1', failCount: '0', totalCount: '1', result: [{ id: '1001', number: order.billno, billStatus: true, errors: [] }] } }
    throw Error(key)
  })
  return { adapter: new KingdeeNativeApprovalAdapter(['100000'], 'hyperzone.test', call), call, current }
}
describe('published Kingdee approval APIs', () => {
  it('reads exactly one source order with a bounded cursor', async () => {
    const { adapter, call } = setup()
    const ctx = await adapter.context(identity, scope, 'review', '1001')
    expect(ctx.targets[0]).toMatchObject({ status: 'B', eligible: true, id: '1001' })
    expect(call.mock.calls.find(c => c[0] === 'FOP_KINGDEE_QUERY_URL')?.[1]).toMatchObject({ query: { afterOrderId: '1000', pageSize: 1, rawWorkbenchFacts: true } })
  })
  it.each([{ billstatus: 'A' }, { hzkj_receipt_status: '0' }, { hzkj_orderstatus: '1' }])('blocks ineligible source facts %j', async change => {
    expect((await setup(change).adapter.context(identity, scope, 'review', '1001')).targets[0].eligible).toBe(false)
  })
  it.each([{ id: '1002' }, { hzkj_operator: { id: '99' } }, { hzkj_org: { id: '200000' } }])('rejects foreign data %j', async change => {
    await expect(setup(change).adapter.context(identity, scope, 'review', '1001')).rejects.toThrow()
  })
  it('uses standard audit and requires matching receipt plus C readback', async () => {
    const { adapter, call } = setup()
    const t = (await adapter.context(identity, scope, 'review', '1001')).targets[0]
    const command = { ...t, operation: 'audit' as const, idempotencyKey: 'a'.repeat(64), requestId: 'request', actorAccountId: 'account', currentScope: scope }
    expect((await adapter.approve(identity, command)).status).toBe('approved')
    expect(call.mock.calls.find(c => c[0] === 'FOP_KINGDEE_FULFILLMENT_AUDIT_URL')).toEqual(['FOP_KINGDEE_FULFILLMENT_AUDIT_URL', { data: { billno: order.billno, org_number: 'hyperzone.test' } }, true, 'a'.repeat(64)])
  })
  it('blocks a changed state before writing', async () => {
    const { adapter, call, current } = setup()
    const t = (await adapter.context(identity, scope, 'review', '1001')).targets[0]
    current.hzkj_receipt_status = '0'
    const r = await adapter.approve(identity, { ...t, operation: 'audit', idempotencyKey: 'a'.repeat(64), requestId: 'r', actorAccountId: 'account', currentScope: scope })
    expect(r.status).toBe('blocked'); expect(call.mock.calls.some(c => c[0].includes('AUDIT_URL'))).toBe(false)
  })
})

describe('allocation receipts and source readback', () => {
  function allocation(result: string, oldCancelledDispatch = false) {
    let status = 'B'
    const source = { ...order, billstatus: 'C', hzkj_orderstatus: '3' }
    const call = jest.fn(async (key: string): Promise<any> => {
      if (key === 'FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL') return { subject: identity, grants: { orders: ['100000'] }, approvalActions: ['allocation_review'] }
      if (key === 'FOP_KINGDEE_QUERY_URL') return { subject: identity, organizationIds: ['100000'], workbenchFactsSchemaVersion: 1, items: [source], facts: {
        allocations: [{ id: '2001', billno: 'AO261028000404', billstatus: status, organizationId: '100000', hzkj_order_id: '1001', hzkj_order_no: source.billno, hzkj_alloc_status: 'completed' }],
        dispatches: [{ id: '3001', billno: 'FY261028000206', billstatus: 'C', organizationId: '100000', hzkj_order_no: source.billno }, ...(oldCancelledDispatch ? [{ id: '3002', billno: 'FY-old', billstatus: 'A', hzkj_delivery_status: 'PENDING', hzkj_ship_block_state: 'CANCELLED', organizationId: '100000', hzkj_order_no: source.billno }] : [])],
      } }
      if (key === 'FOP_KINGDEE_ALLOCATION_TARGETS_URL') return { subject: identity, items: status === 'C' ? [] : [{ id: '2001', number: 'AO261028000404', status, tenantId: identity.tenantId, orderId: '1001', entity: 'hzkj_alloc_bill', version: 'v1', eligible: true, reason: null }] }
      if (key === 'FOP_KINGDEE_ALLOCATION_AUDIT_URL') { if (result === 'approved') status = 'C'; return { status: result, message: result === 'failed' ? '平台业务校验未通过' : '审核成功', warning: result === 'approved' ? '通知后续业务待完成' : null } }
      throw Error(key)
    })
    return { adapter: new KingdeeNativeApprovalAdapter(['100000'], 'hyperzone.test', call), call }
  }
  it('ignores an intercepted/cancelled old dispatch when its replacement is approved', async () => {
    const { adapter } = allocation('approved', true)
    const ctx = await adapter.context(identity, scope, 'allocation_review', '1001')
    expect(ctx.targets[0].eligible).toBe(true)
    expect(ctx.order.dispatchDocuments).toHaveLength(1)
  })
  it.each(['approved','failed','blocked','unknown'])('decodes allocation %s without replaying a write', async status => {
    const { adapter, call } = allocation(status)
    const t = (await adapter.context(identity, scope, 'allocation_review', '1001')).targets[0]
    const r = await adapter.approve(identity, { ...t, operation: 'audit', idempotencyKey: 'b'.repeat(64), requestId: 'request', actorAccountId: 'account', currentScope: scope })
    expect(r.status).toBe(status)
    expect(call.mock.calls.filter(c => c[0] === 'FOP_KINGDEE_ALLOCATION_AUDIT_URL')).toHaveLength(1)
    if (status === 'approved') { expect(r.readback?.documentId).toBe('2001'); expect(r.warning).toBe('通知后续业务待完成') }
    else expect(r.readback).toBeUndefined()
  })
  it('returns the FOP validation reason from a failed standard receipt', async () => {
    const { adapter, call } = setup()
    const original = call.getMockImplementation()!
    call.mockImplementation(async (key, ...args) => key === 'FOP_KINGDEE_FULFILLMENT_AUDIT_URL' ? { operationStatus: false, operationMessage: '地址校验未通过', failCount: '1', successCount: '0', totalCount: '1', result: [{ id: '1001', number: order.billno, billStatus: false, errors: [] }] } : original(key, ...args))
    const t = (await adapter.context(identity, scope, 'review', '1001')).targets[0]
    expect(await adapter.approve(identity, { ...t, operation: 'audit', idempotencyKey: 'b'.repeat(64), requestId: 'request', actorAccountId: 'account', currentScope: scope })).toMatchObject({ status: 'failed', message: '地址校验未通过' })
  })
})
