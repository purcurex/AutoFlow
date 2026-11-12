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
