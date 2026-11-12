import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { LocalWorkbenchService } from './local-workbench.service'
import { UsersService } from '../users/users.service'

const admin = { id: 'account', role: 'admin', workbenchRoles: [], businessRole: 'none', organizationWorkspaceOwnerId: 'workspace', accountDisabled: false }
function setup(companies: Record<string, unknown>[] = []) {
  const query = jest.fn(async (sql: string) => sql.includes('FROM hz_fop_connections') ? companies : [])
  const manager = { query }
  const users = { findById: jest.fn(async () => admin), localWorkbenchOrganization: jest.fn(async () => ({ version: 'scope', departments: [], members: [], employeeIds: null, employeeId: null, departmentId: null })) }
  const db = { query, transaction: jest.fn(async (_isolation, run) => run(manager)) }
  return { service: new LocalWorkbenchService(db as unknown as DataSource, users as unknown as UsersService, new ConfigService({ WORKBENCH_READ_MODE: 'local', FOP_QUERIES_PAUSED: 'true' })), query, users }
}
describe('local workbench fail-closed lifecycle', () => {
  it('defaults to local mode and enables a live provider only explicitly', () => {
    const { service } = setup()
    expect(service.enabled).toBe(true)
    expect(new LocalWorkbenchService({} as DataSource, {} as UsersService, new ConfigService({WORKBENCH_READ_MODE:'live'})).enabled).toBe(false)
    expect(new LocalWorkbenchService({} as DataSource, {} as UsersService, new ConfigService({})).enabled).toBe(true)
  })
  it('rechecks current organization outside the list snapshot before delivering rows', async () => {
    const { service }=setup()
    const snapshot={query:jest.fn()}
    jest.spyOn(service as any,'organization').mockImplementation(async (manager: unknown)=>({version:manager===snapshot?'old':'changed'}))
    const context={user:admin,companies:[{company_id:'co',connection_id:'c'}],signature:JSON.stringify([admin.role,admin.businessRole,undefined,[],undefined,[['co','old']]])}
    await expect((service as any).recheck(context,snapshot)).rejects.toMatchObject({response:{code:'workbench_scope_changed'}})
  })
  it('releases the read connection before current authorization is rechecked', async () => {
    const company={connection_id:'c',company_id:'co',active_dataset_id:null,verified_at:new Date(),expires_at:new Date(Date.now()+60000)}
    const {service}=setup([company]);let active=false
    const db=(service as any).db
    db.transaction.mockImplementation(async (_isolation:unknown,run:(manager:any)=>Promise<any>)=>{active=true;try{return await run({query:async()=>[]})}finally{active=false}})
    jest.spyOn(service as any,'organization').mockImplementation(async()=>{expect(active).toBe(false);return {version:'same'}})
    const context={user:admin,companies:[company],resources:[],grants:new Map(),signature:JSON.stringify([admin.role,admin.businessRole,undefined,[],undefined,[['co','same']]])}
    await expect((service as any).read(async (manager:any)=>{await (service as any).recheck(context,manager);return 'delivered'})).resolves.toBe('delivered')
  })
  it('returns an explicit 503 before count or list on an uninitialized replica', async () => {
    const { service, query } = setup()
    await expect(service.getOrders('account', { queue: 'review', projection: 'count', page: 1, pageSize: 1 })).rejects.toMatchObject({ response: { code: 'workbench_replica_not_initialized' }, status: 503 })
    expect(query.mock.calls.some(([sql]) => sql.includes('count(*)'))).toBe(false)
  })
  it('does not show an empty RMA queue for a fulfillment-only initialized snapshot',async()=>{
    const at=new Date().toISOString()
    const {service}=setup([{connection_id:'c',company_id:'co',active_dataset_id:'d',dataset_state:'active',validated_at:at,activated_at:at,verified_at:at,expires_at:new Date(Date.now()+60000).toISOString(),applied_watermarks:{_local:{entityCodes:['hzkj_orders']}}}])
    await expect(service.getRmaOrders('account',{page:1,pageSize:20,flowStatus:'active'})).rejects.toMatchObject({response:{code:'workbench_replica_entity_not_initialized'}})
  })
  it('exposes configured companies to status before activation without returning business rows', async () => {
    const { service } = setup([{ connection_id: 'c', company_id: 'co', active_dataset_id: null }])
    await expect(service.replicaScope('account')).resolves.toEqual([{ connectionId: 'c', companyId: 'co', datasetId: null }])
  })
  it('does not deliver exports without current source revalidation while FOP is paused', async () => {
    const { service } = setup()
    await expect(service.exportOrders('account', { mode: 'filtered', queue: 'review' }, 0)).rejects.toMatchObject({ response: { code: 'workbench_replica_export_revalidation_required' } })
  })
  it('rejects unsupported projections explicitly rather than returning a zero queue', async () => {
    const { service } = setup()
    await expect(service.getPurchaseReturns('account', { workbenchRole: 'procurement', paidAtOrder: 'desc', page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 503 })
    await expect(service.getStockInventory('account', { page: 1, pageSize: 50 })).rejects.toMatchObject({ status: 503 })
  })
})
