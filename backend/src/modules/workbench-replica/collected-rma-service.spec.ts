import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
function setup(){
 const user:any={id:'admin',role:'admin',sessionVersion:2};const batch={id:'b',company_id:'100000',source_as_of:'2026-11-12T00:00:00Z',metadata:{entityCaptures:{rma:{companyId:'100000',captureId:'c',capturedAt:'2026-11-12T01:00:00Z',coverage:'partial_customer_scan'}}}}
 const users={findById:jest.fn(async()=>user)},db={query:jest.fn(async(sql:string)=>{
  if(sql.includes('SELECT owner_user_id'))return []
  if(sql.includes('FROM hz_fop_collected_batches'))return [batch]
  if(sql.includes('FROM organization_nodes')||sql.includes('FROM organization_employees e'))return []
  if(sql.includes('count(*)::int AS total'))return [{total:1,order_count:1}]
  if(sql.includes('AS currency'))return [{currency:null,amount:null}]
  if(sql.includes('jsonb_array_elements'))return [{quantity:null}]
  if(sql.includes('SELECT display'))return [{display:{id:'r1',items:[],currency:null,amount:null,rmaCases:[{number:'RMA1',type:'refund',isOpen:false,refundAmount:0,refundCurrency:null}]}}]
  throw Error('Unexpected SQL '+sql)
 })};return{service:new CollectedWorkbenchService(db as any,users as any,new ConfigService({FOP_REPLICA_TENANT_ID:'tenant',FOP_REPLICA_COMPANY_ID:'100000'})),db,users,user,batch}
}
it('enables authentic partial captures with explicit partial coverage and missing money, without a business-zero assertion',async()=>{
 const {service}=setup();const page=await service.orders('admin',{queue:'rma',rmaFlowStatus:'all'},'sales',true)
 expect(page.items[0].id).toBe('r1');expect(page.totals.caseCount).toBe(1);expect(page.totals.itemQuantity).toBeNull();expect(page.totals.amountsByCurrency).toEqual([]);expect(page.dataAvailability).toMatchObject({queueAvailable:true,coverage:'partial_customer_scan',provesBusinessZero:false});expect(page.replica.sourceSyncedAt).toBe('2026-11-12T01:00:00Z')
})
it('can total known scoped RMA values without claiming complete company coverage',async()=>{
 const {service,db}=setup(),original=db.query.getMockImplementation()!
 db.query.mockImplementation((async(sql:string)=>sql.includes('AS currency')?[{currency:'USD',amount:'12.50'}]:sql.includes('AS quantity')?[{quantity:'2'}]:original(sql)) as any)
 const page=await service.orders('admin',{queue:'rma',rmaFlowStatus:'all'},'sales',true)
 expect(page.totals).toMatchObject({complete:true,itemQuantity:2,amountsByCurrency:[{currency:'USD',amount:12.5}]})
 expect(page.dataAvailability).toMatchObject({complete:false,coverage:'partial_customer_scan',provesBusinessZero:false})
})
it('rechecks account before delivering partial RMA data',async()=>{
 const {service,users,user}=setup();users.findById.mockImplementationOnce(async()=>user).mockImplementationOnce(async()=>({...user,accountDisabled:true}));await expect(service.orders('admin',{queue:'rma'},'sales',true)).rejects.toThrow()
})
it('exports selected case IDs using RMA-specific columns and repeats scope checks',async()=>{
 const {service,users}=setup();const result=await service.export('admin',{mode:'selected',caseIds:['r1'],rmaFlowStatus:'all'},2,'rma');expect(result).toBeInstanceOf(Buffer);expect(users.findById.mock.calls.length).toBeGreaterThanOrEqual(4)
})
it('refuses a selected export when a case is outside its scoped query',async()=>{
 const {service}=setup();await expect(service.export('admin',{mode:'selected',caseIds:['r1','forbidden'],rmaFlowStatus:'all'},2,'rma')).rejects.toThrow('Selection outside current result')
})
it('uses the exact case ID under the same company and ownership predicates for detail and hides unscoped cases',async()=>{
 const {service,db}=setup();const original=(service as any).context.bind(service)
 jest.spyOn(service as any,'context').mockImplementation(async(...args:any[])=>({...await original(...args),user:{role:'user',sessionVersion:2},filter:{employeeIds:['55']},signature:'scope'}))
 const result=await (service as any).rmaDetail('member','r1');expect(result.item.id).toBe('r1')
 const factQueries=db.query.mock.calls.filter(([sql])=>sql.includes('FROM hz_fop_collected_entities'))
 expect(factQueries.every(([sql])=>sql.includes('owner_employee_id = ANY')&&sql.includes("companyVerified'='true'")&&sql.includes("state'='verified'")&&sql.includes('source_id='))).toBe(true)
})
it('does not disclose unknown-company RMA rows even in administrator all-state queries',async()=>{
 const {service,db}=setup();await service.orders('admin',{queue:'rma',rmaFlowStatus:'all'},'sales',true)
 expect(db.query.mock.calls.filter(([sql])=>sql.includes('FROM hz_fop_collected_entities')).every(([sql])=>sql.includes("companyVerified'='true'"))).toBe(true)
})
