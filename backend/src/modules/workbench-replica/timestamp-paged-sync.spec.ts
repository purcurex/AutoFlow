import { TimestampPagedSync } from './timestamp-paged-sync'
const scope={batchId:'b',tenantId:'t',companyId:'100000',entityCode:'hzkj_orders'}
const old='2026-11-16T00:00:00Z',now='2026-11-16T00:20:00Z'
const row=(id:string)=>({id,companyId:'100000',createdAt:old,modifiedAt:old,raw:{id}})
function fixture(){
 const state:any={watermark:old,fullAt:old,staged:[],failed:false,committed:false,calls:[]}
 const session={checkpoint:async()=>state.watermark,lastFullCapture:async()=>state.fullAt,start:async()=> 'r',ids:async()=>['99'],stage:async(...args:any[])=>state.staged.push(args),fail:async()=>{state.failed=true},commit:async(...args:any[])=>{state.committed=true;state.watermark=args[1];state.deleted=args[2];state.meta=args[4];return {state:'projection_pending',...args[4]}}}
 const source={assertReady:jest.fn(),page:jest.fn(async(_s:any,q:any):Promise<any>=>{state.calls.push(q);return {scope,rows:[],totalCount:0,lastPage:true}})}
 const store:any={exclusive:async(_s:any,fn:any)=>fn(session)}
 return {state,source,session,engine:new TimestampPagedSync(store,source,()=>now,{overlapSeconds:600,safetyLagSeconds:120,pageSize:2,maxPages:1000,fullCompensationSeconds:86400})}
}
describe('ordinary timestamp pages',()=>{
 it('uses one fixed local cutoff, marks eventual publication pending and never deletes missing IDs',async()=>{
  const f=fixture();const result=await f.engine.run(scope,'incremental')
  expect(f.state.watermark).toBe('2026-11-16T00:18:00.000000000Z')
  expect(f.state.calls[0].from).toBe('2026-11-15T23:50:00.000000000Z')
  expect(f.state.deleted).toEqual([]);expect(result.clockBasis).toBe('local_capture_time');expect(result.publicationPending).toBe(true)
 })
 it('persists verified connection identity basis without converting it into a source scope proof',async()=>{
  const f=fixture(),identityBasis={tenantId:'t',userId:'original-user',companyId:'100000',basis:'kingdee_get_connection_context',scopeProof:false}
  Object.assign(f.source,{captureIdentityBasis:()=>identityBasis})
  await f.engine.run(scope,'incremental')
  expect(f.state.meta.identityBasis).toEqual(identityBasis);expect(f.state.meta.sourceScopeProof).toBe(false)
 })
 it('persists page numbers and keeps cutoff across same-time bigint IDs',async()=>{
  const f=fixture();f.source.page.mockImplementation(async(_s,q)=>({scope,rows:q.pageNo===1?[row('9007199254740993'),row('9007199254740994')]:[row('9007199254740995')],totalCount:3,lastPage:q.pageNo===2}))
  await f.engine.run(scope,'incremental');expect(f.state.staged.map((x:any)=>x[2].pageNo)).toEqual([1,2])
  expect(f.state.staged[0][2].to).toBe(f.state.staged[1][2].to)
 })
 it.each(['duplicate','count_change','short_page','out_of_window','transport','commit'])('does not advance W after %s',async kind=>{
  const f=fixture()
  f.source.page.mockImplementation(async(_s,q)=>{
   if(kind==='transport')throw Error('network')
   return {scope,rows:kind==='short_page'?[row('1')]:kind==='out_of_window'?[{...row('1'),modifiedAt:now}]:q.pageNo===1?[row('1'),row('2')]:[row('2')],totalCount:kind==='count_change'&&q.pageNo===2?4:3,lastPage:q.pageNo===2}
  })
  if(kind==='commit'){f.source.page.mockImplementation(async()=>({scope,rows:[],totalCount:0,lastPage:true}));f.session.commit=async()=>{throw Error('transaction rollback')}}
  await expect(f.engine.run(scope,'incremental')).rejects.toThrow();expect(f.state.watermark).toBe(old);expect(f.state.failed).toBe(true);expect(f.state.committed).toBe(false)
 })
 it('requires periodic full compensation but never schedules it automatically',async()=>{
  const f=fixture();f.state.fullAt='2026-11-14T00:00:00Z'
  await expect(f.engine.run(scope,'incremental')).rejects.toThrow('timestamp_full_compensation_required');expect(f.source.page).not.toHaveBeenCalled()
  await f.engine.run(scope,'reconcile');expect(f.state.calls[0].from).toBe('1970-01-01T00:00:00Z');expect(f.state.deleted).toEqual([])
 })
 it.each(['unordered','empty_with_total','last_page_early','last_page_late','total_smaller_than_rows'])('rejects %s without advancing W',async kind=>{
  const f=fixture()
  f.source.page.mockImplementation(async()=>({scope,rows:kind==='empty_with_total'?[]:kind==='last_page_late'?[row('1')]:kind==='unordered'?[{...row('2'),modifiedAt:'2026-11-16T00:00:01Z'},row('1')]:[row('1'),row('2')],totalCount:kind==='last_page_early'||kind==='empty_with_total'?3:kind==='total_smaller_than_rows'||kind==='last_page_late'?1:2,lastPage:kind!=='last_page_late'}))
  await expect(f.engine.run(scope,'incremental')).rejects.toThrow(kind==='unordered'?'timestamp_cursor_not_monotonic':'timestamp_page_incomplete');expect(f.state.watermark).toBe(old);expect(f.state.committed).toBe(false)
 })
 it('initializes from epoch and requires initialization before incremental',async()=>{
  const f=fixture();f.state.watermark=null
  await expect(f.engine.run(scope,'incremental')).rejects.toThrow('timestamp_initialization_required')
  await f.engine.run(scope,'initialize');expect(f.state.calls[0].from).toBe('1970-01-01T00:00:00Z')
 })
})
it('accepts IDs in any order inside a second because the native API truncates source modification precision',async()=>{
 const f=fixture();f.source.page.mockResolvedValue({scope,rows:[row('2'),row('1')],totalCount:2,lastPage:true})
 const result=await f.engine.run(scope,'incremental')
 expect(result).toMatchObject({consistency:'eventual',sameTimestampIdOrderVerified:false})
})
