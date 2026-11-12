import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { ReplicaHttpSource } from './replica-http-source'

it('keeps independent authorization timers off in manual-only mode', async () => {
  const db = { query: jest.fn() } as unknown as DataSource
  const source = { authorization: jest.fn(), isConfigured: () => true } as unknown as ReplicaHttpSource
  const service = new ReplicaAuthorizationService(db, new ConfigService({ WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'false' }), source)
  const timer = jest.spyOn(global, 'setInterval')
  try { service.onModuleInit(); await service.tick(); expect(timer).not.toHaveBeenCalled(); expect(db.query).not.toHaveBeenCalled() }
  finally { service.onModuleDestroy(); timer.mockRestore() }
})

it.each([[-30_000, 20_000, true], [-61_000, 20_000, false], [-10_000, -1, false]])('only consumes a valid existing proof in manual-only mode (%s, %s)', async (verifiedOffset, expiresOffset, valid) => {
  const db = { query: jest.fn(async () => [{ verified_at: new Date(Date.now() + verifiedOffset).toISOString(), expires_at: new Date(Date.now() + expiresOffset).toISOString() }]) } as unknown as DataSource
  const source = { authorization: jest.fn(), isConfigured: () => true } as unknown as ReplicaHttpSource
  const service = new ReplicaAuthorizationService(db, new ConfigService({ WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'false' }), source)
  const refresh = jest.spyOn(service,'refresh')
  const result = service.ensure({connectionId:'c',companyId:'co'})
  if(valid) await expect(result).resolves.toBeUndefined()
  else await expect(result).rejects.toMatchObject({response:{code:'workbench_replica_authorization_stale'}})
  expect(refresh).not.toHaveBeenCalled();expect(source.authorization).not.toHaveBeenCalled()
})

it('preserves pause and Mock isolation before any independent authorization call',async()=>{
  const source={authorization:jest.fn(),isConfigured:()=>true} as unknown as ReplicaHttpSource
  const service=new ReplicaAuthorizationService({} as DataSource,new ConfigService({FOP_QUERIES_PAUSED:'true'}),source)
  await expect(service.refresh({connectionId:'c',companyId:'co'})).rejects.toThrow('fop_queries_paused')
  expect(source.authorization).not.toHaveBeenCalled()
})
it('never reports refreshed authorization on a transaction failure',async()=>{
  const proof={companyAllowed:true,scopeVersion:'v1',sourceAsOf:new Date().toISOString(),expiresAt:new Date(Date.now()+50000).toISOString(),resources:[],employees:[],references:[]}
  const source={authorization:jest.fn().mockResolvedValue(proof),isConfigured:()=>true} as unknown as ReplicaHttpSource
  const db={transaction:async()=>{throw new Error('db failed')}} as unknown as DataSource
  const service=new ReplicaAuthorizationService(db,new ConfigService({}),source)
  await expect(service.refresh({connectionId:'c',companyId:'co'})).rejects.toThrow('db failed')
})
it('does not start an authorization timer for a paused or Mock deployment',()=>{
  const timer=jest.spyOn(global,'setInterval')
  const source={isConfigured:()=>true} as unknown as ReplicaHttpSource
  try{for(const values of [{FOP_QUERIES_PAUSED:'true'},{WORKBENCH_MOCK_ENABLED:'true'}]){
    const service=new ReplicaAuthorizationService({} as DataSource,new ConfigService(values),source)
    service.onModuleInit();service.onModuleDestroy()
  }expect(timer).not.toHaveBeenCalled()}finally{timer.mockRestore()}
})

describe('controlled migration and renewal of existing workspace employee bindings', () => {
  const person = { authUserId: 'auth-1', personRecordId: '101', masterId: '201', number: 'ID-001', enabled: true }
  const candidate = () => ({ local_account_id: 'local-user', local_employee_id: 'local-employee', owner_user_id: 'workspace', organization_workspace_owner_id: 'workspace',
    fop_tenant_id: 'tenant', fop_user_id: 'auth-1', account_disabled: false, archived_at: null, name: 'Sales',
    fop_binding_details: { localEmployeeId: 'local-employee', organizationId: 'company-A', employeeRecordId: '101', employeeMasterId: '201', employeeNumber: 'ID-001', username: 'sales', name: 'Sales', verifiedAt: '2026-01-01T00:00:00Z' } })
  function setup(candidates = [candidate()]) {
    const bindings = new Map<string, Record<string, any>>()
    const proof = { companyAllowed: true, scopeVersion: 'v1', sourceAsOf: new Date().toISOString(), expiresAt: new Date(Date.now() + 50_000).toISOString(), ownershipVector: { orders: '1' }, resources: [], employees: [structuredClone(person)], references: [] }
    const query = jest.fn(async (sql: string, values: any[] = []) => {
      if (sql.includes('FROM hz_fop_companies co JOIN hz_fop_connections')) return [{ id: 'company', tenant_id: 'tenant', workspace_owner_id: 'workspace', source_company_id: 'company-B' }]
      if (sql.includes('SELECT source_company_id FROM hz_fop_companies')) return [{ source_company_id: 'company-A' }, { source_company_id: 'company-B' }]
      if (sql.includes('FROM organization_employees')) return candidates.filter(row => row.owner_user_id === values[0] && (values[1] === undefined || row.fop_tenant_id === values[1]))
      if (sql.includes('FROM hz_fop_employee_bindings b')) return [...bindings.values()].map(binding => ({ ...binding, fop_tenant_id: 'tenant', fop_user_id: 'auth-1' }))
      if (sql.includes('INSERT INTO hz_fop_employee_bindings')) {
        bindings.set(values[2], { id: values[0], local_account_id: values[2], person_record_id: values[3], employee_master_id: values[4], employee_number: values[5], username: values[6], auth_user_id: values[7],
          display_name: values[8], state: values[9], enabled: values[10], directory_verified_at: values[11], identity_verified_at: values[12], last_checked_at: values[13], evidence: JSON.parse(values[14]) })
      }
      return []
    })
    const service = new ReplicaAuthorizationService({ transaction: async (run: any) => run({ query }) } as any, new ConfigService({}), { authorization: async () => proof } as any)
    return { service, bindings, proof, query }
  }
  it('migrates only an existing trusted local employee and matches legacy company against all enabled companies of the connection', async () => {
    const { service, bindings } = setup()
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'identity_verified', enabled: true, auth_user_id: 'auth-1', person_record_id: '101', employee_master_id: '201', employee_number: 'ID-001', identity_verified_at: '2026-01-01T00:00:00Z' })
  })
  it.each(['removed', 'disabled'])('writes a disabled binding after the complete source directory marks the user %s, preventing legacy fallback', async state => {
    const { service, bindings, proof } = setup()
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    if (state === 'removed') proof.employees = []; else proof.employees[0].enabled = false
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'disabled', enabled: false })
  })
  it('does not elevate a bare FOP user ID to a verified binding even if it appears in the directory', async () => {
    const row = candidate(); row.fop_binding_details = null as any
    const { service, bindings } = setup([row])
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'disabled', enabled: false, employee_master_id: null, identity_verified_at: null })
  })
  it('creates no account binding for another workspace', async () => {
    const row = candidate(); row.owner_user_id = 'other-workspace'; row.organization_workspace_owner_id = 'other-workspace'
    const { service, bindings } = setup([row])
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.size).toBe(0)
  })
  it('creates no new binding for a workspace account belonging to another FOP tenant', async () => {
    const row = candidate(); row.fop_tenant_id = 'other-tenant'
    const { service, bindings } = setup([row])
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.size).toBe(0)
  })
  it('blocks mismatched source master/person/number rather than continuing to use trusted legacy details', async () => {
    const { service, bindings, proof } = setup()
    proof.employees[0].masterId = '999'
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'disabled', enabled: false })
  })
  it('does not elevate a preexisting pending binding without trusted legacy identity evidence', async () => {
    const row = candidate(); row.fop_binding_details = null as any
    const { service, bindings } = setup([row])
    bindings.set('local-user', { id: 'pending-binding', local_account_id: 'local-user', state: 'pending', enabled: null, auth_user_id: 'auth-1', evidence: {} })
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'disabled', enabled: false, identity_verified_at: null })
  })
  it('renews an already verified binding by its current auth identity even without legacy details', async () => {
    const row = candidate(); row.fop_binding_details = null as any
    const { service, bindings } = setup([row])
    bindings.set('local-user', { id: 'verified-binding', local_account_id: 'local-user', state: 'identity_verified', enabled: true, auth_user_id: 'auth-1', evidence: {} })
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect(bindings.get('local-user')).toMatchObject({ state: 'identity_verified', enabled: true, employee_master_id: '201' })
  })
  it('keeps conflicting local claims disabled rather than binding one source identity to multiple accounts', async () => {
    const other = candidate(); other.local_account_id = 'other-user'; other.local_employee_id = 'other-employee'; other.fop_binding_details.localEmployeeId = 'other-employee'
    const { service, bindings } = setup([candidate(), other])
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    expect([...bindings.values()].map(binding => [binding.state, binding.enabled])).toEqual([['disabled', false], ['disabled', false]])
  })
  it('does not revoke connection-wide employee identities when one company loses resource access', async () => {
    const { service, bindings, proof } = setup()
    await service.refresh({ connectionId: 'connection', companyId: 'company' })
    proof.companyAllowed = false
    await expect(service.refresh({ connectionId: 'connection', companyId: 'company' })).rejects.toThrow('fop_replica_company_access_denied')
    expect(bindings.get('local-user')).toMatchObject({ state: 'identity_verified', enabled: true })
  })
})
