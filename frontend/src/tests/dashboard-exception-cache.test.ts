import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { getFopOrders } from '@/api/fop-orders'
import { clearDashboardExceptionCache, getDashboardExceptions, peekDashboardExceptions } from '@/utils/dashboard-exception-cache'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/fop-orders',()=>({getFopOrders:vi.fn()}))
const value={items:[],total:12} as never
beforeEach(()=>{clearDashboardExceptionCache();vi.resetAllMocks();vi.useFakeTimers();vi.mocked(getFopOrders).mockResolvedValue(value)})
afterEach(()=>vi.useRealTimers())
it('reuses fresh results and refreshes expired data while keeping a bounded preview',async()=>{
 await getDashboardExceptions();await getDashboardExceptions();expect(getFopOrders).toHaveBeenCalledTimes(1)
 vi.advanceTimersByTime(60001);expect(peekDashboardExceptions()).toBe(value);await getDashboardExceptions();expect(getFopOrders).toHaveBeenCalledTimes(2)
 vi.advanceTimersByTime(300001);expect(peekDashboardExceptions()).toBe(value)
})
it('manual refresh bypasses TTL and concurrent navigation shares one request',async()=>{
 await getDashboardExceptions();let resolve!:(value:any)=>void
 vi.mocked(getFopOrders).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
 const first=getDashboardExceptions(true),second=getDashboardExceptions(true);expect(first).toBe(second);resolve(value);await first;expect(getFopOrders).toHaveBeenCalledTimes(2)
})
it('clears account data and rejects late responses after session change',async()=>{
 await getDashboardExceptions();let resolve!:(value:any)=>void
 vi.mocked(getFopOrders).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
 const pending=getDashboardExceptions(true);invalidateSession();expect(peekDashboardExceptions()).toBeUndefined();resolve(value);await expect(pending).rejects.toThrow();expect(peekDashboardExceptions()).toBeUndefined()
})
it('does not retain cached data after a permission failure',async()=>{
 await getDashboardExceptions();vi.mocked(getFopOrders).mockRejectedValueOnce({status:403});await expect(getDashboardExceptions(true)).rejects.toEqual({status:403});expect(peekDashboardExceptions()).toBeUndefined()
})

it('retains the last result after a temporary network failure',async()=>{await getDashboardExceptions();vi.mocked(getFopOrders).mockRejectedValueOnce(new Error('offline'));await expect(getDashboardExceptions(true)).rejects.toThrow('offline');expect(peekDashboardExceptions()).toBe(value)})
