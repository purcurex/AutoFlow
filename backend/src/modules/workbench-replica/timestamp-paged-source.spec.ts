import { TimestampPagedSource, type TimestampPagedProfile } from './timestamp-paged-source'
import { TimestampPagedSync } from './timestamp-paged-sync'
const scope={batchId:'b',tenantId:'t',companyId:'100000',entityCode:'hzkj_orders'}
const profile:TimestampPagedProfile={version:2,protocol:'ordinary_modified_pages',packageVersion:'2026-11-16',tenantId:'t',companyId:'100000',orgNumber:'hyperzone.test',entityCode:'hzkj_orders',readOnly:true,acknowledgeEventualConsistency:true}
const q={from:'2026-11-16T00:00:00Z',to:'2026-11-16T00:10:00Z',pageNo:1,pageSize:100}
function fixture(){
 const body:any={status:true,errorCode:'0',data:{pageNo:1,pageSize:100,totalCount:1,lastPage:true,filter:'org in (100000) and modifytime >= 1',rows:[{id:'9007199254740993',createtime:'2026-11-16 08:00:00',modifytime:'2026-11-16 08:01:00',hzkj_orders_billentry:[]}]}}
 const transport=jest.fn(async()=>({report:{success:true},rows:body.data.rows,raw:JSON.stringify(body)}))
 return {body,transport,source:new TimestampPagedSource(profile,()=>false,transport)}
}
describe('2026-11-16 ordinary query source',()=>{
 it.each(['hzkj_orders','hzkj_alloc_bill','hzkj_deliver_bill','hzkj_deliver_order'])('accepts the observed native filter grammar for %s',async entityCode=>{
  const f=fixture(),entries={hzkj_orders:'hzkj_orders_billentry',hzkj_alloc_bill:'hzkj_alloc_entry',hzkj_deliver_bill:'hzkj_logisticstrackentry',hzkj_deliver_order:'entryentity'}
  f.body.data.rows[0][entries[entityCode as keyof typeof entries]]=[]
  f.body.data.filter=`[org in (100000) AND 1 = 1 AND org.number = 'hyperzone.test'${entityCode==='hzkj_orders'?" AND hzkj_billtype.number = 'hzkj_orders_BT'":''} AND modifytime >= '2026-11-01 00:00:00' AND modifytime < '2026-11-18 00:00:00']`
  await expect(new TimestampPagedSource({...profile,entityCode},()=>false,f.transport).page({...scope,entityCode},q)).resolves.toMatchObject({totalCount:1})
 })
 it.each([
  'NOT org in (100000)', 'not (org in (100000))', 'org NOT in (100000)',
  'org in (100000) OR org in (200000)', 'org in (200000)', 'org in (100000, 200000)',
  "hzkj_billtype.number = 'org in (100000)'", "'org in (100000)' = 'org in (100000)'",
  "hzkj_billtype.number = 'x'' AND org in (100000)'", 'org in (100000) AND org = 200000',
  'org <> 100000', 'org in (100000) AND NOT modifytime >= 1',
  "org in (100000) AND org.number = 'another-company'", 'org in (100000) /* comment */',
 ])('rejects unproven company scope even on zero rows without moving W: %s',async filter=>{
  const f=fixture();Object.assign(f.body.data,{filter,rows:[],totalCount:0})
  const old=q.from,state={watermark:old}
  const session={checkpoint:async()=>state.watermark,lastFullCapture:async()=>old,start:async()=> 'r',stage:jest.fn(),fail:jest.fn(),commit:jest.fn(async(_r,to)=>{state.watermark=to})}
  const engine=new TimestampPagedSync({exclusive:async(_s:any,fn:any)=>fn(session)} as any,f.source,()=> '2026-11-16T00:20:00Z')
  await expect(engine.run(scope,'incremental')).rejects.toThrow('timestamp_response_scope_invalid')
  expect(state.watermark).toBe(old);expect(session.stage).not.toHaveBeenCalled();expect(session.commit).not.toHaveBeenCalled();expect(session.fail).toHaveBeenCalledWith('r','timestamp_response_scope_invalid')
 })
 it.each(['((org = 100000) AND (modifytime >= 1))', "[org.id in ('100000') AND modifytime < '2026-11-18 00:00:00']"])('accepts explicit positive company conjunctions: %s',async filter=>{
  const f=fixture();f.body.data.filter=filter
  await expect(f.source.page(scope,q)).resolves.toMatchObject({totalCount:1})
 })
 it.each([['hzkj_alloc_bill','allocation','hzkj_alloc_entry'],['hzkj_deliver_bill','dispatch','hzkj_logisticstrackentry'],['hzkj_deliver_order','delivery-notice','entryentity']])('maps %s to its documented route and own entries',async(entityCode,operation,entries)=>{
  const f=fixture();f.body.data.rows[0][entries]=[];f.body.data.rows[0].org_id='100000'
  const source=new TimestampPagedSource({...profile,entityCode},()=>false,f.transport)
  await source.page({...scope,entityCode},q)
  expect(f.transport).toHaveBeenCalledWith(expect.objectContaining({operation,startModifytime:'2026-11-16 08:00:00',endModifytime:'2026-11-16 08:10:00'}))
 })
 it('sends explicit published parameter names with UTC+8 seconds and preserves source values',async()=>{
  const f=fixture(),result=await f.source.page(scope,q)
  expect(f.transport).toHaveBeenCalledWith({operation:'order-list',orgNumber:'hyperzone.test',startModifytime:'2026-11-16 08:00:00',endModifytime:'2026-11-16 08:10:00',pageNo:1,pageSize:100,saveResponse:true})
  expect(result.rows[0].modifiedAt).toBe('2026-11-16T08:01:00+08:00');expect(result.rows[0].raw).toEqual(f.body.data.rows[0])
 })
 it.each(['scope','empty_filter','or_scope','row_company','id','entries','time','page','total','last_flag'])('rejects malformed %s before staging',async kind=>{
  const f=fixture(),raw=f.body.data.rows[0]
  if(kind==='scope')f.body.data.filter='org in (100001)'
  if(kind==='empty_filter')f.body.data.filter=''
  if(kind==='or_scope')f.body.data.filter='org in (100000) or org in (100001)'
  if(kind==='row_company')raw.org_id='100001'
  if(kind==='id')raw.id=9007199254740992
  if(kind==='entries')delete raw.hzkj_orders_billentry
  if(kind==='time')raw.modifytime='invalid'
  if(kind==='page')f.body.data.pageNo=2
  if(kind==='total')f.body.data.totalCount=-1
  if(kind==='last_flag')f.body.data.lastPage='true'
  await expect(f.source.page(scope,q)).rejects.toThrow()
 })
 it('respects pause, unsupported entities and explicit consistency acknowledgement before transport',async()=>{
  const f=fixture()
  for(const [p,paused] of [[profile,true],[{...profile,entityCode:'hzkj_purorderbill'},false],[{...profile,acknowledgeEventualConsistency:false},false]] as const){
   await expect(new TimestampPagedSource(p,()=>paused,f.transport).page(scope,q)).rejects.toThrow()
  }
  expect(f.transport).not.toHaveBeenCalled()
 })
 it('does not round a fractional checkpoint into a different upstream window',async()=>{
  await expect(fixture().source.page(scope,{...q,to:'2026-11-16T00:10:00.001Z'})).rejects.toThrow('timestamp_window_precision')
 })
})
it('preserves native explicit null entry collections for projection instead of aborting the whole capture',async()=>{
 const f=fixture();f.body.data.rows[0].hzkj_orders_billentry=null
 expect((await f.source.page(scope,q)).rows[0].raw.hzkj_orders_billentry).toBeNull()
})
