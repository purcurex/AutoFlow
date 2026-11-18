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
 await service.orders('u1',query,'sales');await service.orders('u1',query,'sales');expect(db.query).toHaveBeenCalledTimes(1);expect(context).toHaveBeenCalledTimes(4)
 await service.orders('u2',query,'sales');revision='2';await service.orders('u1',query,'sales');signature='grant2';await service.orders('u1',query,'sales');employees=['e2'];await service.orders('u1',query,'sales');expect(db.query).toHaveBeenCalledTimes(5)
 await service.orders('u1',{...query,timeRange:'1m'},'sales');await service.orders('u1',{...query,timeRange:'1m'},'sales');expect(db.query).toHaveBeenCalledTimes(7)
 context.mockResolvedValueOnce({user:{role:'admin'},filter:{employeeIds:employees},org:{employeeIds:employees,members:[],departments:[]},batch:{id:'b',company_id:'100000',exception_data_revision:revision,metadata:{}},signature:signature+revision}).mockRejectedValueOnce(new Error('access revoked'))
 await expect(service.orders('u1',query,'sales')).rejects.toThrow('access revoked')
})
