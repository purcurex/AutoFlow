import { TimestampHttpSource } from './timestamp-http-source'
const scope={batchId:'b',tenantId:'t',companyId:'100000',entityCode:'hzkj_orders'}
const action={path:'/kapi/query',body:{data:{org_number:'{{orgNumber}}',from:'{{from}}',until:'{{to}}',last:'{{afterId}}'},limit:'{{limit}}'}}
const profile:any={version:1,verified:true,verificationReference:'FOP reviewed mapping',tenantId:'t',companyId:'100000',orgNumber:'hyperzone.test',entityCode:'hzkj_orders',sourceTimezone:'+08:00',fullDetails:true,companyWide:true,stableKeyset:true,readOnly:true,
 actions:{clock:action,full:action,created:action,modified:action,exists:action},
 response:{success:'status',company:'data.companyId',tenant:'data.tenantId',rows:'data.rows',complete:'data.complete',clock:'data.serverTime',exists:'data.exists'},
 document:{id:'id',company:'org.id',created:'createtime',modified:'modifytime',requiredArrays:['hzkj_orders_billentry']}}
const envelope=(extra:any={})=>({status:true,errorCode:'0',data:{companyId:'100000',tenantId:'t',rows:[],complete:true,serverTime:'2026-11-15 08:00:00',...extra}})
function setup(p=profile){const calls:any[]=[];const source=new TimestampHttpSource(p,{paused:()=>false,token:async()=> 'private-token',identity:'identity',tokenHeader:'access_token'},async(url:any,init:any)=>{calls.push({url,init});return new Response(JSON.stringify(envelope()))});return {source,calls}}
it('maps only confirmed template parameters and reuses the existing gateway credentials',async()=>{
 const f=setup();await f.source.page(scope,{mode:'modified',from:'2026-11-15T00:00:00Z',to:'2026-11-15T01:00:00Z',after:null,limit:100})
 expect(JSON.parse(f.calls[0].init.body)).toEqual({data:{org_number:'hyperzone.test',from:'2026-11-15T00:00:00Z',until:'2026-11-15T01:00:00Z',last:null},limit:100})
 expect(f.calls[0].init.headers.access_token).toBe('private-token');expect(f.calls[0].init.redirect).toBe('error')
})
it('requires verified capabilities and exact scope before obtaining credentials',()=>{
 const f=setup({...profile,verified:false});expect(()=>f.source.assertReady(scope)).toThrow('timestamp_profile_unverified');expect(f.calls).toHaveLength(0)
 expect(()=>setup().source.assertReady({...scope,companyId:'2'})).toThrow('timestamp_profile_scope_mismatch')
})
it('rejects foreign origin paths and mutation paths even in a supplied profile',()=>{
 for(const path of ['https://evil.test/q','//evil.test/q','/kapi/save','/kapi/query?token=x','/kapi/../query'])
  expect(()=>setup({...profile,actions:{...profile.actions,clock:{...action,path}}}).source.assertReady(scope)).toThrow()
})
it('checks pause before credential acquisition and again before business fetch',async()=>{
 let paused=false,calls=0
 const s=new TimestampHttpSource(profile,{paused:()=>paused,token:async()=>{paused=true;return 'token'},identity:'id'},async()=>{calls++;return new Response('{}')})
 await expect(s.clock(scope)).rejects.toThrow('fop_queries_paused');expect(calls).toBe(0)
})
it('preserves timezone and fractional precision from source-local times',async()=>{
 const s=new TimestampHttpSource(profile,{paused:()=>false,token:async()=> 't',identity:'i'},async()=>new Response(JSON.stringify(envelope({rows:[{id:'1',org:{id:'100000'},createtime:'2026-11-15 08:00:00.123456789',modifytime:null,hzkj_orders_billentry:[]}]}))))
 const p=await s.page(scope,{mode:'full',after:null,limit:100});expect(p.rows[0].createdAt).toBe('2026-11-15T08:00:00.123456789+08:00')
})
it.each([envelope({companyId:'2'}),envelope({complete:'true'}),{status:false,data:{rows:[]}},envelope({rows:[{id:'1',org:{id:'100000'},createtime:'2026-11-15T00:00:00Z'}]})])('rejects scope errors, business failures and incomplete details',async response=>{
 const s=new TimestampHttpSource(profile,{paused:()=>false,token:async()=> 't',identity:'i'},async()=>new Response(JSON.stringify(response)))
 await expect(s.page(scope,{mode:'full',after:null,limit:100})).rejects.toThrow()
})
it('a zero-row query is not authoritative absence',async()=>{
 await expect(setup().source.exists(scope,'1')).rejects.toThrow('timestamp_existence_unconfirmed')
})
