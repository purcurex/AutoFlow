import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { getCustomerContribution,type CustomerContributionQuery } from '@/api/local-dashboard-analytics'
import { clearAnalyticsCache } from '@/utils/analytics-cache'
import { invalidateSession } from '@/utils/session'
const {get}=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('@/api/index',()=>({default:{get}}))
const query:CustomerContributionQuery={chartId:'customer_orders',dimension:'person',id:'p1',from:'2026-11-01',to:'2026-11-25',entityType:'fulfillment'}
let version='v1'
const detail=vi.fn()
beforeEach(()=>{
 clearAnalyticsCache();get.mockReset();detail.mockReset();version='v1'
 detail.mockResolvedValue({amount:'100.00',rows:[{id:'c1',amount:'100.00'}]})
 get.mockImplementation((url:string,options:unknown)=>url.endsWith('/cache-scope')?Promise.resolve({cacheable:true,version}):detail(options))
})
afterEach(()=>vi.restoreAllMocks())
it('reopens an authorized detail without querying it again and isolates targets, periods and warehouses',async()=>{
 const [a,b]=await Promise.all([getCustomerContribution(query),getCustomerContribution({...query})])
 a.rows[0]!.amount='0';expect(b.rows[0]!.amount).toBe('100.00')
 await getCustomerContribution(query);expect(detail).toHaveBeenCalledTimes(1)
 for(const extra of [{id:'p2'},{from:'2026-11-02'},{warehouseCode:'HZ'},{entityType:'stock' as const},{dimension:'department' as const}])await getCustomerContribution({...query,...extra})
 expect(detail).toHaveBeenCalledTimes(6)
 await getCustomerContribution(query);expect(detail).toHaveBeenCalledTimes(6)
 version='new-data';await getCustomerContribution(query);expect(detail).toHaveBeenCalledTimes(7)
 invalidateSession();await getCustomerContribution(query);expect(detail).toHaveBeenCalledTimes(8)
})
it('requires a current permission check before reusing cached customers and retries failed reads',async()=>{
 await getCustomerContribution(query)
 get.mockRejectedValueOnce(new Error('permission denied'))
 await expect(getCustomerContribution(query)).rejects.toThrow('permission denied')
 expect(detail).toHaveBeenCalledTimes(1)
 version='revoked';detail.mockRejectedValueOnce(new Error('detail denied'))
 await expect(getCustomerContribution(query)).rejects.toThrow('detail denied')
 await getCustomerContribution(query);expect(detail).toHaveBeenCalledTimes(3)
 await getCustomerContribution(query,{force:true});expect(detail).toHaveBeenCalledTimes(4)
})
