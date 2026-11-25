import { ExceptionPageCache } from './exception-page-cache'
import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
it('expires, bounds memory, coalesces requests and never retains errors or mutable shared results',async()=>{
 let time=0;const cache=new ExceptionPageCache<any>(()=>time,10,2,100),load=jest.fn(async()=>({items:[1]}))
 const first=await cache.read('a',load);first.items.push(2)
 expect(await cache.read('a',load)).toEqual({items:[1]});expect(load).toHaveBeenCalledTimes(1)
 time=11;await Promise.all([cache.read('a',load),cache.read('a',load)]);expect(load).toHaveBeenCalledTimes(2)
 await cache.read('b',load);await cache.read('c',load);await cache.read('a',load);expect(load).toHaveBeenCalledTimes(5)
 const fail=jest.fn(async()=>{throw Error('read failed')});await expect(cache.read('x',fail)).rejects.toThrow();await expect(cache.read('x',fail)).rejects.toThrow();expect(fail).toHaveBeenCalledTimes(2)
})
it('keys SQL reuse by account, permission signature, data revision and scope, and rechecks before returning',async()=>{
 const db={query:jest.fn(async()=>[{total:0,quantity:0,countries:[],rows:[]}])},service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService())
 let revision='1',signature='grant1',employees=['e1']
 const context=jest.spyOn(service as any,'context').mockImplementation(async()=>({user:{role:'admin'},filter:{employeeIds:employees},org:{employeeIds:employees,members:[],departments:[]},batch:{id:'b',company_id:'100000',exception_data_revision:revision,metadata:{}},signature:signature+revision}))
 const query={queue:'exceptions'}
 await service.orders('u1',query,'sales');await service.orders('u1',query,'sales');expect(db.query).toHaveBeenCalledTimes(1);expect(context).toHaveBeenCalledTimes(6)
 await service.orders('u2',query,'sales');revision='2';await service.orders('u1',query,'sales');signature='grant2';await service.orders('u1',query,'sales');employees=['e2'];await service.orders('u1',query,'sales');expect(db.query).toHaveBeenCalledTimes(5)
 await service.orders('u1',{...query,timeRange:'1m'},'sales');await service.orders('u1',{...query,timeRange:'1m'},'sales');expect(db.query).toHaveBeenCalledTimes(6)
 await service.orders('u1',{...query,refresh:true},'sales');expect(db.query).toHaveBeenCalledTimes(7)
 context.mockResolvedValueOnce({user:{role:'admin'},filter:{employeeIds:employees},org:{employeeIds:employees,members:[],departments:[]},batch:{id:'b',company_id:'100000',exception_data_revision:revision,metadata:{}},signature:signature+revision}).mockRejectedValueOnce(new Error('access revoked'))
 await expect(service.orders('u1',query,'sales')).rejects.toThrow('access revoked')
})
it('reuses approved sales reads and bypasses them on refresh',async()=>{
 const db={query:jest.fn(async(sql:string)=>sql.startsWith('SELECT count(*)')?[{total:0,quantity:null}]:[])}
 const service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService())
 const c={user:{role:'admin'},filter:{employeeIds:null},org:{employeeIds:[],members:[],departments:[]},batch:{id:'b',company_id:'100000',metadata:{}},signature:'scope-data-v1'}
 jest.spyOn(service as any,'context').mockResolvedValue(c)
 await service.orders('u',{queue:'review',completed:true},'sales')
 expect(db.query).toHaveBeenCalledTimes(3)
 await service.orders('u',{queue:'review',completed:true},'sales')
 expect(db.query).toHaveBeenCalledTimes(3)
 await service.orders('u',{queue:'review',completed:true,refresh:true},'sales')
 expect(db.query).toHaveBeenCalledTimes(6)
})
it('refresh replaces cached results and ignores a slower older read',async()=>{
 const cache=new ExceptionPageCache<any>()
 let finish!:(value:any)=>void
 const old=cache.read('key',()=>new Promise(resolve=>{finish=resolve}))
 expect(await cache.read('key',async()=>({version:2}),true)).toEqual({version:2})
 finish({version:1});await old
 const load=jest.fn(async()=>({version:3}))
 expect(await cache.read('key',load)).toEqual({version:2});expect(load).not.toHaveBeenCalled()
 expect(await cache.read('key',load,true)).toEqual({version:3})
 expect(await cache.read('key',load)).toEqual({version:3});expect(load).toHaveBeenCalledTimes(1)
})
it.each([
 ['shipping',true,'warehouse'],['shipping',false,'warehouse'],['review',false,'sales'],['unpaid',false,'sales'],
 ['procurement',true,'procurement'],['procurement',false,'procurement'],['procurement_shipping',false,'procurement'],
 ['allocation',false,'allocation'],['allocation_review',false,'allocation'],['dispatch',false,'dispatch'],
])('reuses %s completed=%s local SQL without sharing account permissions',async(queue,completed,role)=>{
 const db={query:jest.fn(async(sql:string)=>sql.startsWith('SELECT count(*)')?[{total:0,quantity:null}]:[])}
 const service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService())
 const captures=Object.fromEntries(['shipping','procurement','dispatch','allocation'].map(k=>[k,{coverage:'full_parent_scan',companyId:'100000'}]))
 const c={user:{role:'admin'},filter:{employeeIds:null},org:{employeeIds:[],members:[],departments:[]},batch:{id:'b',company_id:'100000',metadata:{entityCaptures:captures}},signature:'scope-v1'}
 jest.spyOn(service as any,'context').mockResolvedValue(c)
 await service.orders('u',{queue,completed},role as any);const initial=db.query.mock.calls.length
 expect(initial).toBe(3)
 await service.orders('u',{queue,completed},role as any);expect(db.query).toHaveBeenCalledTimes(initial)
 await service.orders('other',{queue,completed},role as any);expect(db.query).toHaveBeenCalledTimes(initial*2)
})
