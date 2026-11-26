import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
import { WorkbenchController } from '../users/workbench.controller'
import { collaborationChartPermissions } from '../users/chart-permissions'

const query = { from: '2026-11-01', to: '2026-11-12' }
function setup() {
  const db = { query: jest.fn(async (_sql:string,_params:unknown[]): Promise<any[]> => [{ analytics: { customerPaidOrders: { summary: [{ itemQuantity: '9007199254740993.123456789' }] } } }]) }
  const service = new CollectedWorkbenchService(db as any, {} as any, new ConfigService({ WORKBENCH_COLLECTED_ENABLED: 'true' }))
  const context: any = {
    user: { role: 'admin', workbenchRoles: ['sales'], chartPermissions: [] }, signature: 'stable',
    filter: { employeeIds: null }, org: { version: 'v1', employeeIds: null, members: [{ employeeId: '70', departmentId: 'd1' }, { employeeId: '71', departmentId: 'd2' }],
      departments: [{ id: 'marketing', name: '营销中心', parentId: 'root', pathIds: ['root','marketing'] }, { id: 'd1', name: '业务一部', parentId: 'marketing', pathIds: ['root','marketing','d1'] }, { id: 'd2', name: '业务二部', parentId: 'marketing', pathIds: ['root','marketing','d2'] }] },
    batch: { id: 'batch', tenant_id: 'tenant', company_id: '100000', source_as_of: '2026-11-12T00:00:00Z', metadata: { analyticsCaptures: { fulfillment: { companyId: '100000', coverage: 'full_company_scan', capturedAt: '2026-11-12T01:00:00Z' } }, entityCaptures: {} } },
  }
  const contextSpy = jest.spyOn(service as any, 'context').mockResolvedValue(context)
  return { service, db, context, contextSpy }
}

it('returns exact decimal strings, local capture metadata and aggregate-only scope', async () => {
  const { service } = setup()
  const result = await service.analytics('u', query)
  expect(result.customerPaidOrders.summary[0].itemQuantity).toBe('9007199254740993.123456789')
  expect(result.nonconsistentSnapshot).toBe(true)
  expect(result.asOf.fulfillment).toBe('2026-11-12T01:00:00Z')
  expect(result.scope).toMatchObject({ summaryOnly: false, canViewDetails: false, canExport: false })
})
it('rejects unverified source company without touching analytics facts', async () => {
  const { service, db, context } = setup(); context.batch.metadata.analyticsCaptures.fulfillment.companyId = 'other'
  await expect(service.analytics('u', query)).rejects.toThrow('Analytics capture')
  expect(db.query).not.toHaveBeenCalled()
})
it('rejects a permission or capture change after reading aggregates', async () => {
  const { service, contextSpy, context } = setup(); contextSpy.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, signature: 'changed' })
  await expect(service.analytics('u', query)).rejects.toThrow('changed')
})
it('limits collaboration staff to selected department aggregates and forbids owner filtering', async () => {
  const { service, context, db } = setup()
  context.user = { role: 'user', businessRole: 'admin', chartPermissions: collaborationChartPermissions() }
  const volume = context.user.chartPermissions.find((p: any) => p.chartId === 'order_volume'); volume.summaryMode = 'selected'; volume.summaryDepartments = ['sales1']
  const result = await service.analytics('u', query)
  expect(result.scope.summaryOnly).toBe(true)
  expect(db.query.mock.calls[0][1][2]).toEqual(['70'])
  expect(db.query.mock.calls[0][0]).toContain("'summary','null'::jsonb")
  await expect(service.analytics('u', { ...query, ownerId: '70' })).rejects.toThrow('department aggregates')
})
it('never turns an empty/invalid selected summary policy into company-wide data', async () => {
  const { service, context, db } = setup(); context.user = { role: 'user', businessRole: 'admin', chartPermissions: collaborationChartPermissions() }
  const volume = context.user.chartPermissions.find((p: any) => p.chartId === 'order_volume'); volume.summaryMode = 'selected'; volume.summaryDepartments = []
  await expect(service.analytics('u', query)).rejects.toThrow('Analytics access')
  expect(db.query).not.toHaveBeenCalled()
})
it('rejects summary selection outside permitted departments and never exposes unbound owners', async () => {
  const { service, context, db } = setup(); context.user = { role: 'user', businessRole: 'admin', chartPermissions: collaborationChartPermissions() }
  const volume = context.user.chartPermissions.find((p: any) => p.chartId === 'order_volume'); volume.summaryMode = 'selected'; volume.summaryDepartments = ['sales1']
  await expect(service.analytics('u', { ...query, departmentId: 'd2' })).rejects.toThrow('Analytics access')
  expect(db.query).not.toHaveBeenCalled()
})
it('retains an empty explicit department scope without widening it to all employees', async () => {
  const { service, context, db } = setup(); context.user = { role: 'user', businessRole: 'admin', chartPermissions: collaborationChartPermissions() }
  context.org.members = []
  const result = await service.analytics('u', query)
  expect(result.scope.summaryOnly).toBe(true)
  expect(db.query.mock.calls[0][1][2]).toEqual([])
})
it('does not reveal actual freight through a separately denied chart policy', async () => {
  const { service, context, db } = setup()
  context.user = { role: 'user', businessRole: 'admin', chartPermissions: collaborationChartPermissions().filter(p => p.chartId === 'freight') }
  context.batch.metadata.analyticsCaptures.dispatch = { ...context.batch.metadata.analyticsCaptures.fulfillment }
  await service.analytics('u', query)
  expect(db.query.mock.calls[0][0]).toContain("'actualFreight',jsonb_build_object('timeField','occurred_at','available',false")
})
it('offers a dedicated controller route with no old data provider', async () => {
  const { service } = setup(); const controller = new WorkbenchController({} as any, service)
  const result = await controller.getAnalytics({ user: { userId: 'u' } } as any, query)
  expect(result.replica.readMode).toBe('local')
})

it('uses the requested dashboard chart permission rather than inheriting volume visibility',async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'admin',chartPermissions:collaborationChartPermissions()}
 context.user.chartPermissions.find((p:any)=>p.chartId==='customer_orders').visibility='deny'
 await expect(service.dashboardAnalytics('u',{...query,chartId:'customer_orders'})).rejects.toThrow()
 expect(db.query).not.toHaveBeenCalled()
})
it('checks dashboard scope again after querying the local database',async()=>{
 const {service,context,contextSpy}=setup()
 contextSpy.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'new'})
 await expect(service.dashboardAnalytics('u',{...query,chartId:'order_volume'})).rejects.toThrow('Permission or source changed')
})
it('reads customer registrations using their creation window and current user-to-employee mappings',async()=>{
 const {service,context,db}=setup()
 context.org.members[0].fopUserId='900'
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-01-01T00:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 const result=await service.dashboardAnalytics('u',{...query,chartId:'registrations'})
 expect(result.timeBasis).toBe('customer_created_at')
 expect(result.amountBasis).toBeNull()
 expect(db.query.mock.calls[0][0]).toContain('hz_fop_collected_customer_registrations')
 expect(db.query.mock.calls[0][1][5]).toContain('900')
})
it('publishes the confirmed Huazhi customer catalogue through the same local permission query',async()=>{
 const {service,context,db}=setup()
 context.batch.tenant_id='hyperzone.test'
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',tenantId:'hyperzone.test',sourceEntity:'hzkj_member_customer',basis:'user_confirmed_company_catalogue',confirmedOn:'2026-11-16'},connectionProof:{tenantId:'hyperzone.test',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-01-01T00:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 const result=await service.dashboardAnalytics('u',{...query,chartId:'registrations'})
 expect(result.timeBasis).toBe('customer_created_at')
 expect(db.query.mock.calls[0][1][1]).toBe('100000')
 context.batch.metadata.analyticsCaptures.registrations.scopeProof.tenantId='other'
 await expect(service.dashboardAnalytics('u',{...query,chartId:'registrations'})).rejects.toMatchObject({response:{code:'local_analytics_capture_unavailable'}})
})
it('does not publish partial registration windows or accept irrelevant order filters',async()=>{
 const {service,context,db}=setup()
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-11-10T00:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 await expect(service.dashboardAnalytics('u',{...query,chartId:'registrations'})).rejects.toThrow('registration capture does not cover')
 context.batch.metadata.analyticsCaptures.registrations.start='2026-01-01T00:00:00Z'
 for(const extra of [{warehouseCode:'W1'},{currency:'USD'},{entityType:'fulfillment'}])await expect(service.dashboardAnalytics('u',{...query,chartId:'registrations',...extra})).rejects.toThrow('Registration analytics')
 expect(db.query).not.toHaveBeenCalled()
})

it.each(['scope','tenant','company','identity'])('rejects unverified customer capture %s before querying local facts',async kind=>{
 const {service,context,db}=setup()
 const capture:any={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-01-01T00:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 if(kind==='scope')delete capture.scopeProof
 if(kind==='tenant')capture.connectionProof.tenantId='other'
 if(kind==='company')capture.scopeProof.companyId='other'
 if(kind==='identity')delete capture.connectionProof.userId
 context.batch.metadata.analyticsCaptures.registrations=capture
 await expect(service.dashboardAnalytics('u',{...query,chartId:'registrations'})).rejects.toMatchObject({response:{code:'local_analytics_capture_unavailable'}})
 expect(db.query).not.toHaveBeenCalled()
})

it('advertises the last fully captured UTC+8 date only to accounts with registration access',async()=>{
 const {service,context}=setup()
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'1969-12-31T16:00:00Z',end:'2026-11-16T16:00:00Z',capturedAt:'2026-11-16T10:41:50Z'}
 expect((await service.dashboardShell('u')).registrationWindow).toEqual({from:'1970-01-01',to:'2026-11-16',asOf:'2026-11-16T10:41:50Z'})
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'70',workbenchRoles:['sales'],chartPermissions:[{chartId:'registrations',visibility:'deny',dataScope:'inherit',summaryMode:'inherit',summaryDepartments:[],details:'inherit',export:'inherit'}]}
 expect((await service.dashboardShell('u')).registrationWindow).toBeUndefined()
})
it.each(['end','identity','scope'])('does not advertise an unverified registration %s window',async kind=>{
 const {service,context}=setup()
 const capture:any={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'1969-12-31T16:00:00Z',end:'2026-11-16T16:00:00Z',capturedAt:'2026-11-16T10:41:50Z'}
 if(kind==='end')capture.end='bad'
 if(kind==='identity')capture.connectionProof.tenantId='elsewhere'
 if(kind==='scope')capture.scopeProof.companyId='other'
 context.batch.metadata.analyticsCaptures.registrations=capture
 expect((await service.dashboardShell('u')).registrationWindow).toBeUndefined()
})

it('does not expose local freight through company scope and a legacy explicit allow',async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'admin',workbenchRoles:['sales'],chartPermissions:[{chartId:'freight',visibility:'allow',dataScope:'inherit',summaryMode:'inherit',summaryDepartments:[],details:'allow',export:'allow'}]}
 context.batch.metadata.analyticsCaptures.dispatch={...context.batch.metadata.analyticsCaptures.fulfillment}
 await service.analytics('u',query)
 expect(db.query.mock.calls[0][0]).toContain("'actualFreight',jsonb_build_object('timeField','occurred_at','available',false")
})

it('returns the marketing root once as the administrator default, including empty business departments', async()=>{
 const {service,context,db}=setup()
 context.org.departments.push({id:'d3',name:'业务三部',parentId:'marketing',pathIds:['root','marketing','d3']},{id:'outside',name:'业务四部',parentId:'other',pathIds:['root','other','outside']})
 context.org.members.push({employeeId:'outside',departmentId:'outside'})
 const result=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(result.defaultDepartmentId).toBe('marketing')
 expect(result.departments.map((d:any)=>d.id)).toEqual(['marketing','d1','d2','d3'])
 expect(db.query.mock.calls[0][1][2]).toEqual(['70','71'])
})
it('returns the mapped own department as default without expanding personal records', async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'department_manager',businessDepartmentId:'d1',businessEmployeeId:'70',workbenchRoles:['sales']}
 context.org={...context.org,marketingScope:{rootId:'marketing',departmentIds:['d1','d2']},departments:context.org.departments.filter((d:any)=>d.id==='d1'),members:[context.org.members[0]],departmentId:'d1',employeeId:'70',employeeIds:['70']}
 const result=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(result.defaultDepartmentId).toBe('d1')
 expect(result.departments).toEqual([{id:'d1',name:'业务一部'}])
 expect(db.query.mock.calls[0][1][2]).toEqual(['70'])
})
it('does not offer the marketing root when a collaboration chart permits only selected departments',async()=>{
 const {service,context}=setup()
 const policies=collaborationChartPermissions()
 Object.assign(policies.find(p=>p.chartId==='order_volume')!,{summaryMode:'selected',summaryDepartments:['sales1']})
 context.user={role:'user',businessRole:'admin',chartPermissions:policies}
 context.org.members=[]
 const result=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(result.departments).toEqual([{id:'d1',name:'业务一部'}])
 expect(result.defaultDepartmentId).toBe('d1')
 await expect(service.dashboardAnalytics('u',{...query,chartId:'order_volume',departmentId:'marketing'})).rejects.toThrow()
})

it('compares authorized local aggregates in one SQL snapshot and repeats identical filters',async()=>{
 const {service,db}=setup()
 db.query.mockResolvedValue([{analytics:{orderCount:15},previous:{orderCount:10}}])
 const result=await service.dashboardAnalytics('u',{...query,chartId:'order_volume',comparison:'month',warehouseCode:'W1'})
 expect(db.query).toHaveBeenCalledTimes(1)
 const [sql,params]=db.query.mock.calls[0]
 expect(sql).toContain('CROSS JOIN (WITH filtered')
 expect(sql.match(/source AS MATERIALIZED/g)).toHaveLength(1)
 expect(params).toHaveLength(11);expect(params[6]).toEqual(['W1']);expect(params[0]).toBe('batch')
 expect(sql).toContain('paid_at >= $10::timestamptz AND paid_at < $11::timestamptz')
 expect(result.comparison.metrics[0]).toMatchObject({current:15,previous:10,percent:50})
})
it('returns no prior-period values before the business date floor',async()=>{
 const {service,db}=setup();db.query.mockResolvedValue([{analytics:{orderCount:15}}])
 const result=await service.dashboardAnalytics('u',{from:'2026-01-01',to:'2026-01-10',chartId:'order_volume',comparison:'month'})
 expect(result.comparison).toMatchObject({available:false,previousData:null,metrics:[]})
 expect(db.query.mock.calls[0][1]).toHaveLength(9)
})
it('keeps captured current registrations when the previous creation window is not captured',async()=>{
 const {service,context,db}=setup()
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-10-31T16:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 db.query.mockResolvedValue([{analytics:{registrationCount:3,orderCount:3}}])
 const result=await service.dashboardAnalytics('u',{...query,chartId:'registrations',comparison:'month'})
 expect(result.registrationCount).toBe(3)
 expect(result.comparison).toMatchObject({available:false,previousData:null,metrics:[]})
 expect(db.query.mock.calls[0][1]).toHaveLength(6)
})

it('merges manager own-member aggregates with peer summaries without widening primary record counts',async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'department_manager',businessDepartmentId:'d1',dataDisplayScope:'self',workbenchRoles:['sales'],chartPermissions:[]}
 context.org={...context.org,marketingScope:{rootId:'marketing',departmentIds:['d1','d2']},departmentId:'d1',employeeIds:['70'],analyticsPeers:{departments:context.org.departments,members:context.org.members},members:[context.org.members[0]],departments:context.org.departments.filter((d:any)=>d.id==='d1')}
 db.query.mockResolvedValue([{analytics:{orderCount:2,rows:[{dimension:'person',id:'70',departmentId:'d1',orderCount:2},{dimension:'department',id:'d1',orderCount:2}]},departmentSummary:{orderCount:7,rows:[{dimension:'department',id:'d1',orderCount:2},{dimension:'department',id:'d2',orderCount:5}]}}])
 const result=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(result.orderCount).toBe(2);expect(result.departmentSummary.orderCount).toBe(7)
 expect(result.rows.filter((r:any)=>r.dimension==='person').map((r:any)=>r.id)).toEqual(['70'])
 expect(result.rows.filter((r:any)=>r.dimension==='department')).toHaveLength(2)
 expect(result.departments.map((d:any)=>d.id)).toEqual(['marketing','d1','d2'])
 expect(result.defaultDepartmentId).toBe('marketing');expect(result.summaryOnly).toBe(false)
 expect(db.query.mock.calls[0][1][2]).toEqual(['70']);expect(db.query.mock.calls[0][1][11]).toEqual(['70','71'])
 db.query.mockClear();db.query.mockResolvedValue([{analytics:{orderCount:5,rows:[{dimension:'department',id:'d2',orderCount:5}]}}])
 const peer=await service.dashboardAnalytics('u',{...query,chartId:'order_volume',departmentId:'d2'})
 expect(peer.summaryOnly).toBe(true);expect(peer.departmentSummary).toBeUndefined()
 expect(db.query.mock.calls[0][0]).not.toContain("('person',")
 expect(db.query.mock.calls[0][1][2]).toEqual(['71'])
 await expect(service.dashboardAnalytics('u',{...query,chartId:'order_volume',departmentId:'d2',warehouseCode:'W1'})).resolves.toMatchObject({summaryOnly:true})
})

it('returns only time aggregates for an authorized dashboard trend',async()=>{
 const {service,db}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[{dimension:'month',id:'2026-11',label:'2026-11',orderCount:2,quantity:'3',amount:null}],orderCount:2,totalQuantity:'3',missingAmountCount:0,missingPaidAtCount:0}}])
 const result=await service.dashboardTrend('u',{...query,chartId:'order_volume',dimension:'person',id:'70',grain:'month'})
 expect(result.points).toHaveLength(1)
 expect(result).not.toHaveProperty('departments')
 expect(result).not.toHaveProperty('rows')
 expect(db.query.mock.calls[0][1].slice(-1)[0]).toBe('70')
})
it('returns customer trend dollars with accompanying order counts and preserves unknown amounts',async()=>{
 const {service,db}=setup()
 const analytics={rows:[{dimension:'month',id:'2026-11',orderCount:2,amount:'20.50'}],orderCount:2,amountsByCurrency:[{currency:'USD',amount:'20.50',orderCount:2}],missingAmountCount:0}
 db.query.mockResolvedValue([{analytics}])
 const args={...query,chartId:'customer_orders' as const,dimension:'customer' as const,id:'c1',grain:'month' as const}
 const result=await service.dashboardTrend('u',args)
 expect(result).toMatchObject({currency:'USD',amount:'20.50',orderCount:2,points:[{amount:'20.50',orderCount:2}]})
 db.query.mockResolvedValue([{analytics:{...analytics,missingAmountCount:1}}])
 expect(await service.dashboardTrend('u',{...args,id:'c2'})).toMatchObject({amount:null,orderCount:2})
})
it('coalesces identical trend reads and reuses their SQL result while rechecking authorization',async()=>{
 const {service,db,contextSpy}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[{id:'2026-11',orderCount:2}],orderCount:2}}])
 const args={...query,chartId:'order_volume' as const,dimension:'person' as const,id:'70',grain:'month' as const}
 const [first,second]=await Promise.all([service.dashboardTrend('u',args),service.dashboardTrend('u',args)])
 expect(db.query).toHaveBeenCalledTimes(1)
 first.points[0].orderCount=999
 expect(second.points[0].orderCount).toBe(2)
 expect((await service.dashboardTrend('u',args)).points[0].orderCount).toBe(2)
 expect(db.query).toHaveBeenCalledTimes(1)
 expect(contextSpy).toHaveBeenCalledTimes(6)
})
it('invalidates trend cache by account, query, source revision and expiry',async()=>{
 const now=jest.spyOn(Date,'now').mockReturnValue(1000)
 try{
 const {service,db,context}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:2}}])
 const args={...query,chartId:'order_volume' as const,dimension:'person' as const,id:'70',grain:'month' as const}
 await service.dashboardTrend('u',args);await service.dashboardTrend('u',args)
 expect(db.query).toHaveBeenCalledTimes(1)
 await service.dashboardTrend('other',args)
 await service.dashboardTrend('u',{...args,grain:'day'})
 context.signature='new-source';await service.dashboardTrend('u',args)
 expect(db.query).toHaveBeenCalledTimes(4)
 now.mockReturnValue(31001);await service.dashboardTrend('u',args)
 expect(db.query).toHaveBeenCalledTimes(5)
 }finally{now.mockRestore()}
})
it('never serves a cached trend after access is revoked or changes during the read',async()=>{
 const {service,db,context,contextSpy}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:2}}])
 const args={...query,chartId:'order_volume' as const,dimension:'person' as const,id:'70',grain:'month' as const}
 await service.dashboardTrend('u',args)
 contextSpy.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'revoked'})
 await expect(service.dashboardTrend('u',args)).rejects.toThrow('Permission or source changed')
 expect(db.query).toHaveBeenCalledTimes(1)
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'71',businessDepartmentId:'d2',workbenchRoles:['sales']}
 context.org.employeeIds=['71'];context.org.employeeId='71'
 await expect(service.dashboardTrend('u',args)).rejects.toThrow()
 expect(db.query).toHaveBeenCalledTimes(1)
})
it('rejects personal trend requests outside the current chart record grant',async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'70',businessDepartmentId:'d1',workbenchRoles:['sales']}
 context.org.employeeIds=['70'];context.org.employeeId='70'
 await expect(service.dashboardTrend('u',{...query,chartId:'order_volume',dimension:'person',id:'71',grain:'day'})).rejects.toThrow()
 expect(db.query).not.toHaveBeenCalled()
})
it('allows department trends for summary-only accounts without exposing personal dimensions',async()=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'admin',chartPermissions:collaborationChartPermissions()}
 await expect(service.dashboardTrend('u',{...query,chartId:'order_volume',dimension:'person',id:'70',grain:'month'})).rejects.toThrow()
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:0}}])
 const result=await service.dashboardTrend('u',{...query,chartId:'order_volume',dimension:'department',id:'d1',grain:'month'})
 expect(result.summaryOnly).toBe(true)
 expect(db.query.mock.calls[0][0]).not.toContain("('person',")
})

it('uses peer department aggregates for manager trends but rejects peer member targets and revoked scope',async()=>{
 const {service,context,db,contextSpy}=setup()
 context.user={role:'user',businessRole:'department_manager',businessDepartmentId:'d1',workbenchRoles:['sales'],chartPermissions:[]}
 context.org={...context.org,marketingScope:{rootId:'marketing',departmentIds:['d1','d2']},departmentId:'d1',employeeIds:['70'],analyticsPeers:{departments:context.org.departments,members:context.org.members},members:[context.org.members[0]],departments:context.org.departments.filter((d:any)=>d.id==='d1')}
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:0}}])
 const args={...query,chartId:'order_volume' as const,dimension:'department' as const,id:'d2',grain:'month' as const}
 const result=await service.dashboardTrend('u',args)
 expect(result.summaryOnly).toBe(true)
 expect(db.query.mock.calls[0][1][2]).toEqual(['70','71'])
 expect(db.query.mock.calls[0][0]).not.toContain("('person',")
 await expect(service.dashboardTrend('u',{...args,dimension:'person',id:'71'})).rejects.toThrow()
 contextSpy.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'revoked'})
 await expect(service.dashboardTrend('u',args)).rejects.toThrow('Permission or source changed')
})

it('returns bounded customer contributions with exact totals and excludes unrelated result metadata',async()=>{
 const {service,db}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[{id:'c1',label:'Customer',amount:'20.50',orderCount:2}],customerCount:1,orderCount:2,amountsByCurrency:[{currency:'USD',amount:'20.50'}],missingAmountCount:0}}])
 const result=await (service as any).customerContribution('u',{...query,chartId:'customer_orders',dimension:'person',id:'70',warehouseCode:'HZ',currency:'USD'})
 expect(result).toMatchObject({limit:5,amount:'20.50',orderCount:2,customerCount:1,currency:'USD',rows:[{id:'c1',amount:'20.50'}]})
 expect(result).not.toHaveProperty('departments')
 expect(db.query.mock.calls[0][1].slice(-1)[0]).toBe('70')
 db.query.mockResolvedValue([{analytics:{rows:[],customerCount:0,orderCount:2,amountsByCurrency:[{currency:'USD',amount:'10.50'}],missingAmountCount:1}}])
 expect(await (service as any).customerContribution('u',{...query,chartId:'customer_orders',dimension:'department',id:'d1'})).toMatchObject({limit:10,amount:null,missingAmountCount:1})
})
it('customer contributions reject summary-only, foreign target and revoked detail grants',async()=>{
 const {service,context,db}=setup()
 const args={...query,chartId:'customer_orders',dimension:'department',id:'d1'}
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'70',businessDepartmentId:'d1',workbenchRoles:['sales'],chartPermissions:[]};context.org.employeeIds=['70'];context.org.employeeId='70'
 await expect((service as any).customerContribution('u',{...args,dimension:'person',id:'71'})).rejects.toThrow()
 await expect((service as any).customerContribution('u',{...args,id:'d2'})).rejects.toThrow()
 context.user.chartPermissions=[{chartId:'customer_orders',visibility:'allow',dataScope:'inherit',summaryMode:'inherit',summaryDepartments:[],details:'deny',export:'inherit'}]
 await expect((service as any).customerContribution('u',args)).rejects.toThrow()
 context.user.chartPermissions[0].details='allow';context.user.chartPermissions[0].dataScope='none'
 await expect((service as any).customerContribution('u',args)).rejects.toThrow()
 expect(db.query).not.toHaveBeenCalled()
})
it('manager customer contributions stay within the assigned department',async()=>{
 const {service,context,db,contextSpy}=setup()
 context.user={role:'user',businessRole:'department_manager',businessDepartmentId:'d1',workbenchRoles:['sales'],chartPermissions:[]}
 context.org={...context.org,marketingScope:{rootId:'marketing',departmentIds:['d1','d2']},departmentId:'d1',employeeIds:['70'],analyticsPeers:{departments:context.org.departments,members:context.org.members},members:[context.org.members[0]],departments:context.org.departments.filter((d:any)=>d.id==='d1')}
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:0,customerCount:0,amountsByCurrency:[]}}])
 const args={...query,chartId:'customer_orders',dimension:'department',id:'d1'}
 await expect((service as any).customerContribution('u',args)).resolves.toMatchObject({limit:10,rows:[]})
 expect(db.query.mock.calls[0][1][2]).toEqual(['70'])
 await expect((service as any).customerContribution('u',{...args,id:'d2'})).rejects.toThrow()
 await expect((service as any).customerContribution('u',{...args,dimension:'person',id:'71'})).rejects.toThrow()
 contextSpy.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'revoked'})
 await expect((service as any).customerContribution('u',args)).rejects.toThrow('Permission or source changed')
})
it('contribution target metadata only advertises customer-detail grants',async()=>{
 const {service,context,db}=setup()
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:0}}])
 const data=await service.dashboardAnalytics('u',{...query,chartId:'customer_orders'})
 expect(data.customerContributionTargets).toEqual(expect.arrayContaining([{dimension:'department',id:'d1'},{dimension:'person',id:'70'}]))
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'70',businessDepartmentId:'d1',workbenchRoles:['sales'],chartPermissions:[{chartId:'customer_orders',visibility:'allow',dataScope:'inherit',summaryMode:'inherit',summaryDepartments:[],details:'deny',export:'inherit'}]}
 context.org.employeeIds=['70'];context.org.employeeId='70'
 expect((await service.dashboardAnalytics('u',{...query,chartId:'customer_orders'})).customerContributionTargets).toEqual([])
})

it('reuses customer ranking for five minutes, coalesces reads and invalidates by source revision',async()=>{
 const now=jest.spyOn(Date,'now').mockReturnValue(1000)
 try{
  const {service,db,context,contextSpy}=setup()
  db.query.mockResolvedValue([{analytics:{rows:[{id:'c1',amount:'20.50'}],customerCount:1,orderCount:2,amountsByCurrency:[{currency:'USD',amount:'20.50'}]}}])
  const args={...query,chartId:'customer_orders' as const,dimension:'person' as const,id:'70'}
  const [first,second]=await Promise.all([service.customerContribution('u',args),service.customerContribution('u',args)])
  first.rows[0].amount='999';expect(second.rows[0].amount).toBe('20.50')
  now.mockReturnValue(121000)
  expect((await service.customerContribution('u',args)).rows[0].amount).toBe('20.50')
  expect(db.query).toHaveBeenCalledTimes(1);expect(contextSpy).toHaveBeenCalledTimes(6)
  context.signature='new-source';await service.customerContribution('u',args)
  expect(db.query).toHaveBeenCalledTimes(2)
  now.mockReturnValue(421001);await service.customerContribution('u',args)
  expect(db.query).toHaveBeenCalledTimes(3)
 }finally{now.mockRestore()}
})

it('changes browser cache revision after a receipt amount supplement',async()=>{
 const {service,context}=setup();(service as any).config.set('WORKBENCH_READ_MODE','local')
 const before=await service.analyticsCacheScope('u')
 context.batch.metadata.receiptSupplement={updatedAt:'2026-11-25T00:00:00Z'}
 expect((await service.analyticsCacheScope('u')).version).not.toBe(before.version)
})
it('does not cache an unavailable customer aggregate and allows an immediate retry',async()=>{
 const {service,db}=setup()
 const args={...query,chartId:'customer_orders' as const,dimension:'person' as const,id:'70'}
 db.query.mockResolvedValueOnce([]).mockResolvedValue([{analytics:{rows:[],customerCount:0,orderCount:0,amountsByCurrency:[]}}])
 await expect(service.customerContribution('u',args)).rejects.toThrow('Local aggregate unavailable')
 await expect(service.customerContribution('u',args)).resolves.toMatchObject({rows:[],orderCount:0})
 expect(db.query).toHaveBeenCalledTimes(2)
})

it.each(['registrations','salesperson_receipts','order_volume','customer_orders'] as const)('only offers the salesperson own department for %s, retaining common warehouse filters',async chartId=>{
 const {service,context,db}=setup()
 context.user={role:'user',businessRole:'salesperson',businessEmployeeId:'70',businessDepartmentId:'d1',workbenchRoles:['sales'],chartPermissions:[]}
 context.org.employeeIds=['70'];context.org.employeeId='70';context.org.departmentId='d1'
 context.batch.metadata.analyticsCaptures.registrations={companyId:'100000',coverage:'company_creation_window',scopeProof:{companyId:'100000',basis:'native_response_createorg_conjunction'},connectionProof:{tenantId:'tenant',userId:'900',companyId:'100000',basis:'authenticated_connection_context'},start:'2026-01-01T00:00:00Z',end:'2026-12-01T00:00:00Z',capturedAt:'2026-11-16T00:00:00Z'}
 db.query.mockResolvedValue([{analytics:{rows:[],orderCount:0,warehouses:[{id:'HZ',name:'杭州仓'},{id:'SZ',name:'深圳仓'}]}}])
 const result=await service.dashboardAnalytics('u',{...query,chartId,...chartId==='registrations'?{}:{warehouseCode:'SZ'}})
 expect(result.departments).toEqual([{id:'d1',name:'业务一部'}]);expect(result.defaultDepartmentId).toBe('d1')
 expect(result.warehouses).toHaveLength(2);expect(db.query.mock.calls[0][1][2]).toEqual(['70'])
 for(const departmentId of ['marketing','d2'])await expect(service.dashboardAnalytics('u',{...query,chartId,departmentId})).rejects.toThrow()
 await expect(service.dashboardTrend('u',{...query,chartId,dimension:'person',id:'71',grain:'month'})).rejects.toThrow()
})

it('uses marketing as the admin initial selection even when the account is assigned to a department',async()=>{
 const {service,context,db}=setup();context.org.departmentId='d2'
 const data=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(data.defaultDepartmentId).toBe('marketing');expect(data.selectedDepartmentId).toBe('marketing')
 expect(db.query.mock.calls[0][1][2]).toEqual(['70','71'])
})
it('queries exactly the first authorized department when a collaboration account has no marketing grant',async()=>{
 const {service,context,db}=setup();const policies=collaborationChartPermissions()
 Object.assign(policies.find(p=>p.chartId==='order_volume')!,{summaryMode:'selected',summaryDepartments:['sales1','sales2']})
 context.user={role:'user',businessRole:'admin',chartPermissions:policies}
 const data=await service.dashboardAnalytics('u',{...query,chartId:'order_volume'})
 expect(data.departments.map((d:any)=>d.id)).toEqual(['d1','d2'])
 expect(data.defaultDepartmentId).toBe('d1');expect(data.selectedDepartmentId).toBe('d1')
 expect(db.query.mock.calls[0][1][2]).toEqual(['70'])
 db.query.mockClear()
 const second=await service.dashboardAnalytics('u',{...query,chartId:'order_volume',departmentId:'d2'})
 expect(second.selectedDepartmentId).toBe('d2');expect(db.query.mock.calls[0][1][2]).toEqual(['71'])
})
