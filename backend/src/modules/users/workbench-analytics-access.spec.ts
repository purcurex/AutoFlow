import { WorkbenchController } from './workbench.controller'
import { ForbiddenException } from '@nestjs/common'
const req:any={user:{userId:'u'}}
const query:any={chartId:'order_volume',from:'2026-11-01',to:'2026-11-10'}
it('rejects non-admin before running any aggregate',async()=>{
 const access:any={requireAdmin:jest.fn().mockRejectedValue(new ForbiddenException())},collected:any={dashboardAnalytics:jest.fn()}
 await expect(new WorkbenchController(access,collected).getWorkbenchAnalytics(req,query)).rejects.toThrow(ForbiddenException)
 expect(collected.dashboardAnalytics).not.toHaveBeenCalled()
})
it('reads local aggregates and checks admin again before returning',async()=>{
 const access:any={requireAdmin:jest.fn().mockResolvedValue(undefined)},collected:any={dashboardAnalytics:jest.fn().mockResolvedValue({source:'local'})}
 expect(await new WorkbenchController(access,collected).getWorkbenchAnalytics(req,query)).toEqual({source:'local'})
 expect(access.requireAdmin).toHaveBeenCalledTimes(2)
})
it('does not return results after administrator demotion',async()=>{
 const access:any={requireAdmin:jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenException())},collected:any={dashboardAnalytics:jest.fn().mockResolvedValue({source:'local'})}
 await expect(new WorkbenchController(access,collected).getWorkbenchAnalytics(req,query)).rejects.toThrow(ForbiddenException)
})
