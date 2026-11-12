import { FopDataService } from './fop-data.service'
import { FopDataProvider, type FopPermissionGrant } from './fop-data.types'
import type { UsersService } from '../users/users.service'

const identity = { tenantId: 'tenant', userId: 'fop-user' }
class Provider extends FopDataProvider {
  grant: FopPermissionGrant = { subject: identity, allowedOrderIds: [] }
  isConfigured() { return true }
  async resolvePermissions() { return this.grant }
  async listOrders(): Promise<never> { throw new Error('Source orders must not be fetched without an RMA grant') }
}
function setup() {
  const provider = new Provider()
  const account = { id: 'local', role: 'user', businessRole: 'salesperson', businessEmployeeId: 'employee', fopTenantId: identity.tenantId, fopUserId: identity.userId, workbenchRoles: ['sales'] }
  const service = new FopDataService({ findById: async () => account } as unknown as UsersService, provider)
  return { service, provider, account }
}
const query = { flowStatus: 'active' as const, page: 1, pageSize: 50 }

describe('RMA integration state', () => {
  it('reports missing independent RMA integration instead of a successful empty page', async () => {
    const { service } = setup()
    await expect(service.getRmaOrders('local', query)).rejects.toMatchObject({ status: 503, response: { code: 'fop_rma_not_configured' } })
  })
  it('keeps an explicitly granted empty RMA scope as a genuine empty result', async () => {
    const { service, provider } = setup()
    provider.grant.allowedRmaCaseIds = []
    await expect(service.getRmaOrders('local', query)).resolves.toMatchObject({ source: 'fop', total: 0, items: [], totals: { caseCount: 0 } })
  })
  it('does not disguise a provider without RMA reading as an upstream outage', async () => {
    const { service, provider } = setup()
    provider.grant.allowedRmaCaseIds = ['rma-1']
    await expect(service.getRmaOrders('local', query)).rejects.toMatchObject({ status: 503, response: { code: 'fop_rma_not_configured' } })
  })
  it('does not export an unconfigured RMA scope as an empty selection', async () => {
    const { service } = setup()
    await expect(service.exportRmaOrders('local', { mode: 'filtered', flowStatus: 'active' })).rejects.toMatchObject({ status: 503, response: { code: 'fop_rma_not_configured' } })
  })
  it('keeps workbench authorization checks before integration state', async () => {
    const { service, account } = setup()
    account.workbenchRoles = ['warehouse']
    await expect(service.getRmaOrders('local', query)).rejects.toMatchObject({ status: 403 })
  })
  it('does not accept a missing RMA contract on the final authorization read', async () => {
    const { service, provider } = setup()
    let reads = 0
    provider.resolvePermissions = async () => ++reads === 1 ? { ...provider.grant, allowedRmaCaseIds: [] } : provider.grant
    await expect(service.getRmaOrders('local', query)).rejects.toMatchObject({ status: 503, response: { code: 'fop_rma_not_configured' } })
  })
})
