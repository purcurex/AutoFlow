import { Workbook } from 'exceljs'
import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
const batch={id:'batch',workspace_owner_id:'admin',source_as_of:'2026-11-12T00:00:00Z',page_count:2}
function setup(){
 const user:any={id:'admin',role:'admin',sessionVersion:2}
 const users={findById:jest.fn(async()=>user)}
 const db={query:jest.fn(async(sql:string,_params?:unknown[])=>{
  if(sql.includes('SELECT owner_user_id'))return []
  if(sql.includes('FROM hz_fop_collected_batches'))return [batch]
  if(sql.includes('FROM organization_nodes'))return []
  if(sql.includes('FROM organization_employees e'))return []
  if(sql.includes('count(*)'))return [{total:1,quantity:null}]
  if(sql.includes('SELECT DISTINCT country_code'))return [{country_code:'US'}]
  if(sql.includes('SELECT display'))return [{display:{id:'1',items:[],amount:null,currency:null}}]
  throw Error('Unexpected SQL')
 })}
 const config=new ConfigService({WORKBENCH_COLLECTED_ENABLED:'true',FOP_REPLICA_TENANT_ID:'tenant',FOP_REPLICA_COMPANY_ID:'company'})
 return {user,users,db,service:new CollectedWorkbenchService(db as any,users as any,config)}
}
describe('collected local reads',()=>{
 it.each(['rma','review'])('blocks stale ordinary-user ownership for %s after captured reassignment',async queue=>{
  const {user,service}=setup();user.role='user';user.businessRole='salesperson';user.organizationWorkspaceOwnerId='admin';user.workbenchRoles=['sales'];(batch as any).metadata={timestampOwnershipPending:true}
  try{await expect(service.orders('admin',{queue},'sales')).rejects.toThrow('关联归属投影待重算')}finally{delete (batch as any).metadata}
 })
 it('blocks analytics using stale ownership after captured reassignment',async()=>{
  const {user,service}=setup();user.role='user';user.businessRole='salesperson';user.organizationWorkspaceOwnerId='admin';(batch as any).metadata={timestampOwnershipPending:true}
  try{await expect(service.dashboardShell('admin')).rejects.toThrow('关联归属投影待重算')}finally{delete (batch as any).metadata}
 })
 it('reads persisted fields with missing amount and quantities unchanged',async()=>{const {service,db}=setup();const result=await service.orders('admin',{queue:'review'},'sales');expect(result.items[0].amount).toBeNull();expect(result.totals.itemQuantity).toBeNull();expect(result.replica.dataMode).toBe('collected');expect(result.dataAvailability.missingDatasets).toBeUndefined();expect(db.query.mock.calls.find(c=>c[0].includes('FROM hz_fop_collected_batches'))?.[1]).toEqual(['admin','tenant','company'])})
 it('marks uncollected results unavailable and never reads order rows',async()=>{const {service,db}=setup();const result=await service.orders('admin',{queue:'allocation'},'allocation');expect(result.items).toEqual([]);expect(result.dataAvailability.missingDatasets.length).toBeGreaterThan(0);expect(db.query.mock.calls.some(c=>c[0].includes('SELECT display'))).toBe(false)})
 it('denies disabled accounts before querying any batch',async()=>{const {user,service,db}=setup();user.accountDisabled=true;await expect(service.status('admin')).rejects.toThrow();expect(db.query).not.toHaveBeenCalled()})
 it('denies salesperson with no verified local assignment',async()=>{const {user,service}=setup();user.role='user';user.businessRole='salesperson';user.organizationWorkspaceOwnerId='admin';user.workbenchRoles=['sales'];await expect(service.orders('admin',{queue:'review'},'sales')).rejects.toThrow('Verified local employee')})
 it('rechecks current account before delivery',async()=>{const {users,service,user}=setup();users.findById.mockImplementationOnce(async()=>user).mockImplementationOnce(async()=>({...user,accountDisabled:true}));await expect(service.orders('admin',{queue:'review'},'sales')).rejects.toThrow()})
 it('rejects exports from expired sessions',async()=>{const {service}=setup();await expect(service.export('admin',{queue:'review',mode:'filtered'},0,'orders')).rejects.toThrow('Session expired')})
 it('honors a disabled current binding before legacy verified details',async()=>{
  const {user,service,db}=setup();user.role='user';user.businessRole='salesperson';user.organizationWorkspaceOwnerId='admin';user.workbenchRoles=['sales'];
  const original=db.query.getMockImplementation()!
  db.query.mockImplementation(async(sql,params)=>{
   if(sql.includes('FROM organization_nodes'))return [{id:'root',parent_id:null,kind:'organization',name:'Org'},{id:'dept',parent_id:'root',kind:'department',name:'Sales'}] as any
   if(sql.includes('FROM organization_employees e')){
    expect(sql).toContain('b.id AS binding_id');expect(sql).toContain('b.state AS binding_state')
    return [{id:'employee',department_id:'dept',account_id:'admin',name:'Member',fop_tenant_id:'tenant',fop_binding_details:{organizationId:'company',localEmployeeId:'employee',employeeMasterId:'123',employeeRecordId:'456',employeeNumber:'E1',verifiedAt:'2026-01-01T00:00:00Z'},binding_id:'binding',binding_enabled:false,binding_state:'disabled'}] as any
   }
   return original(sql,params)
  })
  await expect(service.orders('admin',{queue:'review'},'sales')).rejects.toThrow('Verified local employee')
 })

})

it('rejects delivery when an entity capture changes within the same fulfillment batch',async()=>{
 const {service,db}=setup();const original=db.query.getMockImplementation()!
 const b=batch as any;b.metadata={entityCaptures:{stock_orders:{captureId:'before'}}}
 db.query.mockImplementation(async(sql,params)=>{const result=await original(sql,params);if(sql.includes('SELECT DISTINCT country_code'))b.metadata={entityCaptures:{stock_orders:{captureId:'after'}}};return result})
 try{await expect(service.orders('admin',{queue:'review'},'sales')).rejects.toThrow('Local permission or batch changed')}
 finally{delete b.metadata}
})

it.each(['filtered','selected'])('stock procurement %s export uses procurement authorization',async mode=>{
 const {service}=setup();const seen:string[]=[]
 jest.spyOn(service as any,'context').mockImplementation(async(_id:any,role:any)=>{seen.push(role);if(role!=='procurement')throw Error('Wrong export role');return {user:{sessionVersion:2},batch:{id:'b',source_as_of:'2026-01-01T00:00:00Z',metadata:{entityCaptures:{stock_orders:{capturedAt:'2026-01-01T00:00:00Z'}}}},signature:'same'}})
 jest.spyOn(service,'orders').mockResolvedValue({items:[{id:'1',stockNumber:'S',items:[]}],total:1,page:1,pageSize:100,replica:{readMode:'local',datasetId:'b',revision:'r'}} as any)
 await expect(service.export('admin',{queue:'procurement',mode,...(mode==='selected'?{orderIds:['1']}:{})},2,'stock')).resolves.toBeInstanceOf(Buffer)
 expect(seen).toEqual(['procurement','procurement'])
})
it.each(['filtered','selected'])('denies procurement %s stock export to sales-only authorization',async mode=>{
 const {service}=setup();jest.spyOn(service as any,'context').mockImplementation(async(_id:any,role:any)=>{if(role!=='sales')throw Error('Workbench access denied');return {} })
 await expect(service.export('admin',{queue:'procurement',mode,...(mode==='selected'?{orderIds:['1']}:{})},2,'stock')).rejects.toThrow('Workbench access denied')
})
it('keeps partial stock aggregates unknown and incomplete',async()=>{
 const {service,db}=setup(),b=batch as any;b.metadata={entityCaptures:{stock_orders:{capturedAt:'2026-01-01T00:00:00Z'}}};const original=db.query.getMockImplementation()!
 db.query.mockImplementation(async(sql,params)=>{
  if(sql.includes('to_regclass'))return [{name:'hz_fop_collected_entities'}] as any
  if(sql.includes('AS currency,sum')||sql.includes("AS currency,CASE")){expect(sql).toContain("count(display->>'amount')=count(*)");return [{currency:'USD',amount:null}] as any}
  if(sql.includes('jsonb_array_elements')){expect(sql).toContain("count(line->>'quantity')=count(*)");return [{quantity:null}] as any}
  if(sql.includes('SELECT DISTINCT display'))return []
  return original(sql,params)
 })
 try{const r=await service.orders('admin',{queue:'all',projection:'count'},'sales',true);expect(r.totals.complete).toBe(false);expect(r.totals.itemQuantity).toBeNull();expect(r.totals.amounts[0].amount).toBeNull()}
 finally{delete b.metadata}
})

it.each(['procurement','procurement_shipping','rma'])('identifies local collected implementation gaps separately from upstream evidence for %s',async queue=>{
 const {service}=setup()
 const result=await service.orders('admin',{queue},queue==='rma'?'sales':'procurement',queue==='rma')
 expect(result.dataAvailability.queueAvailable).toBe(false)
 expect(result.dataAvailability.localImplementation).toEqual(queue==='rma'?{state:'implemented_awaiting_scoped_capture',required:[]}:{state:'not_implemented',required:['source_normalization_and_import','independent_scope_and_relations','queue_classification_and_query','detail_and_export']})
 expect(result.dataAvailability.sourceEvidence).toMatchObject({state:queue==='rma'?'empty_legacy_rma_response':'successful_empty_legacy_response',provesBusinessZero:false,provesAuthorizationFailure:false})
})
it.each(['receipt_notices','procurement_groups','purchase_returns'])('reports collected local prerequisite for independent dataset %s',async queue=>{
 const {service}=setup();const result:any=await service.unavailable('admin',{queue},'warehouse')
 expect(result.dataAvailability.localImplementation.state).toBe('not_implemented')
 expect(result.dataAvailability.sourceEvidence.provesBusinessZero).toBe(false)
})

 it.each([['allocation',false],['allocation_review',false],['allocation_review',true]])('reads %s completed=%s from captured allocations only after explicit complete company scope',async(queue,completed)=>{
  const {service,db}=setup(),b=batch as any;b.company_id='company';b.metadata={entityCaptures:{allocation:{coverage:'full_company_scan',companyId:'company',capturedAt:'2026-11-12T00:00:00Z'}}}
  const original=db.query.getMockImplementation()!;db.query.mockImplementation(async(sql,params)=>sql.includes('AS display,raw FROM hz_fop_collected_orders')?[{display:{id:'1',items:[],allocationDocuments:[{id:'2'}]}}] as any:original(sql,params))
  try{const result=await service.orders('admin',{queue,completed},'allocation');expect(result.dataAvailability.queueAvailable).toBe(true);expect(result.items[0].allocationDocuments).toEqual([{id:'2'}]);expect(db.query.mock.calls.some(c=>c[0].includes("a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id"))).toBe(true)}finally{delete b.metadata;delete b.company_id}
 })
describe('business chain access',()=>{
 it('rejects invalid IDs and disabled accounts before reading the chain',async()=>{
  const {service,user,db}=setup();await expect(service.businessChain('admin','bad/id')).rejects.toMatchObject({status:400});expect(db.query).not.toHaveBeenCalled()
  user.accountDisabled=true;await expect(service.businessChain('admin','123')).rejects.toMatchObject({status:401});expect(db.query).not.toHaveBeenCalled()
 })
 it('does not query a chain when collected mode is disabled',async()=>{
  const {db,users}=setup();const service=new CollectedWorkbenchService(db as any,users as any,new ConfigService({WORKBENCH_COLLECTED_ENABLED:'false'}))
  await expect(service.businessChain('admin','123')).rejects.toMatchObject({status:503});expect(db.query).not.toHaveBeenCalled()
 })
})
describe('local dashboard shell',()=>{
 it('keeps administrator chart permissions when analytics data is unavailable',async()=>{
  const {service}=setup();const result=await service.dashboardShell('admin')
  expect(result.analyticsConfigured).toBe(false)
  expect(result.chartAccess.filter((c:any)=>c.visible).length).toBe(7)
  expect(result.registrations).toEqual([]);expect(result.receipts.departments).toEqual([])
 })
 it('denies disabled accounts instead of manufacturing display permissions',async()=>{
  const {service,user}=setup();user.accountDisabled=true;await expect(service.dashboardShell('admin')).rejects.toMatchObject({status:401})
 })
})

it('dispatch classification no longer requires downstream capture to list native approved order stages',async()=>{const {service}=setup();const result=await service.orders('admin',{queue:'dispatch'},'dispatch');expect(result.queueState).toBe('ready')})


it.each(['dispatch','shipping'])('projects current %s logistics into the public logisticsInfo field',async queue=>{
 const {service,db}=setup()
 await service.orders('admin',{queue,completed:true},queue==='dispatch'?'dispatch':'warehouse')
 const sql=db.query.mock.calls.find(c=>c[0].includes(' AS display,raw FROM hz_fop_collected_orders'))?.[0]
 expect(sql).toContain("jsonb_build_object('logisticsInfo',display->'"+(queue==='dispatch'?'dispatchLogistics':'warehouseLogistics')+"')")
})

it.each(['dispatch','shipping'])('exports %s actual logistics with typed tracking and no quotation fallback',async queue=>{
 const {service}=setup()
 jest.spyOn(service as any,'context').mockResolvedValue({user:{sessionVersion:2},batch:{id:'b',source_as_of:'2026-11-12T00:00:00Z'},signature:'same'})
 jest.spyOn(service,'orders').mockResolvedValue({items:[{id:'1',orderNumber:'TO1',items:[],logisticsChannels:[{name:'Quote',code:'Q'}],logisticsInfo:[{channelName:null,trackingNumbers:[{type:'full',number:'001YT'},{type:'last_mile',number:'002WC'}]}]}],total:1,page:1,pageSize:100,replica:{readMode:'local',datasetId:'b',revision:'r'}} as any)
 const buffer=await service.export('admin',{queue,completed:true,mode:'filtered'},2,'orders')
 const wb=new Workbook();await wb.xlsx.load(buffer as any)
 const values:string[]=[];wb.worksheets[0].eachRow(r=>r.eachCell(c=>values.push(String(c.value))))
 expect(values).toContain('物流渠道 / 跟踪号')
 expect(values).toContain('—\n001YT QC\n002WC WC')
 expect(values.join(' ')).not.toContain('Quote')
})


it.each([1,2])('uses the captured fulfillment actual Chinese channel without guessing across %s dispatch groups',async count=>{
 const {service,db}=setup();const original=db.query.getMockImplementation()!
 db.query.mockImplementation(async(sql,params)=>{
  if(sql.startsWith('SELECT display ||'))return [{raw:{hzkj_logistics_channel:{name:'云途德国专线',number:'YT-DE'}},display:{id:'1',items:[],logisticsInfo:Array.from({length:count},(_,i)=>({channelName:null,trackingNumbers:[{type:'full',number:'00'+i}]}))}}] as any
  return original(sql,params)
 })
 const result=await service.orders('admin',{queue:'dispatch',completed:true},'dispatch')
 expect(result.items[0].logisticsChannels).toEqual([{name:'云途德国专线',code:'YT-DE'}])
 expect(result.items[0].logisticsInfo[0].channelName).toBe(count===1?'云途德国专线':null)
})
it('exports review actual channel names separately from the custom channel',async()=>{
 const {service}=setup()
 jest.spyOn(service as any,'context').mockResolvedValue({user:{sessionVersion:2},batch:{id:'b',source_as_of:'2026-11-12T00:00:00Z'},signature:'same'})
 jest.spyOn(service,'orders').mockResolvedValue({items:[{id:'1',orderNumber:'TO261109051364',items:[],customLogisticsChannelName:'HZpacket Standard Electronics',logisticsChannels:[{name:'万邦快线含电',code:'WB'},{name:'万邦快线含电',code:'WB'}]}],total:1,page:1,pageSize:100,replica:{readMode:'local',datasetId:'b',revision:'r'}} as any)
 const buffer=await service.export('admin',{queue:'review',mode:'filtered'},2,'orders')
 const wb=new Workbook();await wb.xlsx.load(buffer as any)
 const values:string[]=[];wb.worksheets[0].eachRow(r=>r.eachCell(c=>values.push(String(c.value))))
 expect(values).toContain('实际物流渠道')
 expect(values).toContain('万邦快线含电')
 expect(values).toContain('HZpacket Standard Electronics')
})

it.each([false,true])('pending dispatch uses the dispatch header number even when package tracking exists=%s',async hasPackage=>{
 const {service,db}=setup(),original=db.query.getMockImplementation()!
 db.query.mockImplementation(async(sql,params)=>{
  if(sql.includes(' AS display,raw FROM hz_fop_collected_orders'))return [{raw:{hzkj_logistics_info:[{hzkj_channel_name:'包裹渠道',hzkj_tracking_number:hasPackage?'PACKAGE-OLD':null}]},display:{id:'1',items:[],dispatchDocuments:[
   {id:'d1',number:'FY261106000398',association:{state:'verified'},deliveryStatus:'TRACKING_OBTAINED',channelName:'云途全球专线挂号（特惠普货）',trackingNumbers:[{type:'full',number:'YT2631000709107661'},{type:'last_mile',number:'CNB30416458'}]},
   {id:'old',deliveryStatus:'CANCELLED',trackingNumbers:[{type:'full',number:'CANCELLED'}]},
   {id:'bad',association:{state:'unresolved'},trackingNumbers:[{type:'full',number:'UNRESOLVED'}]}
  ]}}] as any
  return original(sql,params)
 })
 const result=await service.orders('admin',{queue:'dispatch',completed:false},'dispatch')
 expect(result.items[0].logisticsInfo).toEqual([{channelName:'云途全球专线挂号（特惠普货）',channelCode:null,trackingNumbers:[{type:'full',number:'YT2631000709107661'}]}])
 expect(result.items[0].trackingNumber).toBe('YT2631000709107661')
})

describe('local analytics cache authorization',()=>{
 it('is disabled outside local collected mode without querying business records',async()=>{
  const {service,db}=setup()
  expect(await service.analyticsCacheScope('admin')).toEqual({cacheable:false})
  expect(db.query).not.toHaveBeenCalled()
 })
 it('changes version for scope, permissions, organization and session changes, and data refreshes',async()=>{
  const {user,users,db}=setup()
  const config=new ConfigService({WORKBENCH_COLLECTED_ENABLED:'true',WORKBENCH_READ_MODE:'local'})
  const service=new CollectedWorkbenchService(db as any,users as any,config)
  const c:any={user,org:{version:'v1'},batch:{id:'b',metadata:{timestampSync:{}}}}
  jest.spyOn(service as any,'context').mockResolvedValue(c)
  const first=await service.analyticsCacheScope('admin')
  expect(first.cacheable).toBe(true);expect(first.version).toMatch(/^[a-f0-9]{64}$/)
  c.batch.metadata.timestampSync={updatedAt:'new'}
  expect((await service.analyticsCacheScope('admin')).version).not.toBe(first.version)
  for(const change of [()=>{user.dataDisplayScope='department'},()=>{user.sessionVersion++},()=>{c.org.version='v2'},()=>{user.chartPermissions=[{chartId:'freight',visible:false}]},()=>{c.batch.id='b2'}]){
   const previous=await service.analyticsCacheScope('admin');change()
   expect((await service.analyticsCacheScope('admin')).version).not.toBe(previous.version)
  }
  expect(db.query).not.toHaveBeenCalled()
 })
 it('rejects cache reuse when current authorization is revoked',async()=>{
  const {users,db}=setup()
  const service=new CollectedWorkbenchService(db as any,users as any,new ConfigService({WORKBENCH_COLLECTED_ENABLED:'true',WORKBENCH_READ_MODE:'local'}))
  jest.spyOn(service as any,'context').mockRejectedValue(new Error('denied'))
  await expect(service.analyticsCacheScope('admin')).rejects.toThrow('denied')
 })
})
