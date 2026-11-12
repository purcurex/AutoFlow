import { ConfigService } from '@nestjs/config'
import * as ExcelJS from 'exceljs'
import { LocalWorkbenchService } from './local-workbench.service'

const order = { id: 'o1', orderNumber: 'TO1', shopifyOrderNumber: '#1', customerName: 'Client', storeName: 'Shop', salesperson: 'Sales', warehouse: 'Hangzhou',
  amount: 20, currency: 'USD', paidAt: '2026-11-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', reviewStatus: 'pending', paymentStatus: 'paid', items: [{ sku: 'SKU', name: 'Product', imageUrl: null, variant: '', quantity: 2 }] }
function setup() {
  const user = { id: 'account', role: 'admin', businessRole: 'admin', sessionVersion: 2, organizationWorkspaceOwnerId: 'workspace', workbenchRoles: [] }
  const company = { connection_id: 'connection', company_id: 'company', active_dataset_id: 'dataset', dataset_state: 'active', validated_at: new Date(), activated_at: new Date(),
    tenant_id: 'tenant', source_company_id: '10', workspace_owner_id: 'workspace', scope_version: '1', verified_at: new Date(), expires_at: new Date(Date.now() + 60_000), applied_watermarks: { _local: { projectionRevision: '7' } } }
  const proof = { scopeVersion: 'scope-1', ownershipVector: { orders: '7' } }
  const grant = { verified_at: company.verified_at, source_as_of: company.verified_at, expires_at: company.expires_at }
  const db = { query: jest.fn(async (sql: string) => sql.includes('hz_fop_resource_grants') ? [grant] : sql.includes('hz_fop_sync_streams') ? [{ stream_key: 'orders', source_scope_version: 'scope-1', applied_cursor: '7' }] : sql.includes('FROM hz_fop_connections') ? [company] : []) }
  const authorization = { refresh: jest.fn(async (_scope: unknown) => proof), ensure: jest.fn(async () => undefined) }
  const users = { findById: jest.fn(async () => user) }
  const service = new LocalWorkbenchService(db as any, users as any, new ConfigService({ WORKBENCH_READ_MODE: 'local', WORKBENCH_MOCK_ENABLED: 'false' }), authorization as any)
  let reads = 0
  const read = jest.spyOn(service, 'getOrders').mockImplementation(async (_id, query) => {
    reads++
    return { items: [structuredClone(order)], total: 1, page: query.page, pageSize: query.pageSize, source: 'fop',
      replica: { readMode: 'local', datasetId: company.active_dataset_id, revision: `company:${company.applied_watermarks._local.projectionRevision}` } } as any
  })
  return { service, authorization, company, user, users, grant, read, proof, readCount: () => reads }
}
describe('real local replica exports with offline authorization source', () => {
  it('forces independent authorization before reading and immediately before delivery, preserving real source labeling', async () => {
    const { service, authorization, read, proof } = setup()
    const events: string[] = []
    authorization.refresh.mockImplementation(async () => { events.push('refresh'); return proof })
    const original = read.getMockImplementation()!
    read.mockImplementation(async (id, query) => { events.push('read'); return original(id, query) })
    const buffer = await service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    expect(book.getWorksheet('订单清单')?.getCell('A2').text).toBe('TO1')
    const info = JSON.stringify(book.getWorksheet('导出说明')?.getSheetValues())
    expect(info).toContain('FOP'); expect(info).not.toContain('Mock')
    expect(events[0]).toBe('refresh'); expect(events[events.length - 1]).toBe('refresh')
    expect(authorization.refresh).toHaveBeenCalledTimes(2)
    expect(authorization.refresh).toHaveBeenCalledWith({ connectionId: 'connection', companyId: 'company' })
    expect(authorization.ensure).not.toHaveBeenCalled()
  })
  it('refuses delivery when authorization is revoked after the workbook was generated', async () => {
    const { service, authorization, proof } = setup()
    authorization.refresh.mockResolvedValueOnce(proof).mockRejectedValueOnce(new Error('fop_replica_company_access_denied'))
    await expect(service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)).rejects.toThrow()
    expect(authorization.refresh).toHaveBeenCalledTimes(2)
  })
  it('refuses a final authorization proof whose ownership barrier is ahead of the published local streams', async () => {
    const { service, authorization, proof } = setup()
    authorization.refresh.mockResolvedValueOnce(proof).mockResolvedValueOnce({ ...proof, ownershipVector: { orders: '8' } })
    await expect(service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)).rejects.toMatchObject({ response: { code: 'workbench_replica_export_revalidation_required' } })
  })
  it('rechecks freshness after the final session lookup consumes the remaining source lease', async () => {
    const { service, authorization, company, grant, users, user, proof } = setup()
    let clock = Date.now(), refreshed = 0, finalAccountReads = 0
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
    authorization.refresh.mockImplementation(async () => {
      if (++refreshed === 2) {
        company.verified_at = new Date(clock); company.expires_at = new Date(clock + 1000)
        grant.verified_at = company.verified_at; grant.source_as_of = company.verified_at; grant.expires_at = company.expires_at
      }
      return proof
    })
    users.findById.mockImplementation(async () => { if (refreshed === 2 && ++finalAccountReads === 2) clock += 2000; return user })
    try { await expect(service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)).rejects.toMatchObject({ response: { code: 'workbench_replica_export_revalidation_required' } }) }
    finally { now.mockRestore() }
  })
  it.each(['stale', 'future', 'grant'])('rejects a final %s company/resource proof even when data and role stay identical', async invalid => {
    const { service, authorization, company, grant, proof } = setup()
    let refreshed = 0
    authorization.refresh.mockImplementation(async () => {
      if (++refreshed === 2) {
        if (invalid === 'stale') company.verified_at = new Date(Date.now() - 60_001)
        if (invalid === 'future') company.verified_at = new Date(Date.now() + 5000)
        grant.verified_at = company.verified_at; grant.source_as_of = company.verified_at
        if (invalid === 'grant') grant.expires_at = new Date(Date.now() - 1)
      }
      return proof
    })
    await expect(service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)).rejects.toMatchObject({ response: { code: 'workbench_replica_export_revalidation_required' } })
  })
  it.each(['dataset', 'revision', 'session', 'content'])('refuses delivery after %s changes during complete re-read', async change => {
    const { service, company, user, read } = setup()
    const original = read.getMockImplementation()!
    let n = 0
    read.mockImplementation(async (id, query) => {
      const result = await original(id, query)
      if (++n === 2) {
        if (change === 'dataset') company.active_dataset_id = 'replaced'
        if (change === 'revision') company.applied_watermarks._local.projectionRevision = '8'
        if (change === 'session') user.sessionVersion++
        if (change === 'content') result.items[0].amount = 99
      }
      return result
    })
    await expect(service.exportOrders('account', { queue: 'review', mode: 'filtered' }, 2)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
