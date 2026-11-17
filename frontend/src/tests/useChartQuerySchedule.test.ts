import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useChartQuerySchedule } from '@/composables/useChartQuerySchedule'
vi.mock('@/utils/session',()=>({onSessionReset:()=>()=>{}}))
afterEach(()=>vi.useRealTimers())
it('runs first selection immediately, coalesces rapid changes and isolates charts',()=>{
 vi.useFakeTimers()
 const scope=effectScope(), a=vi.fn(), b=vi.fn(), invalidate=vi.fn()
 const [first,second]=scope.run(()=>[useChartQuerySchedule(a,invalidate),useChartQuerySchedule(b,vi.fn())])!
 first!.schedule();second!.schedule()
 first!.schedule();first!.schedule()
 expect(a).toHaveBeenCalledTimes(1);expect(b).toHaveBeenCalledTimes(1)
 expect(invalidate).toHaveBeenCalledTimes(2)
 vi.advanceTimersByTime(199);expect(a).toHaveBeenCalledTimes(1)
 vi.advanceTimersByTime(1);expect(a).toHaveBeenCalledTimes(2)
 expect(b).toHaveBeenCalledTimes(1)
 scope.stop()
})
it('manual query cancellation and unmount discard queued selections',()=>{
 vi.useFakeTimers()
 const scope=effectScope(), query=vi.fn()
 const scheduler=scope.run(()=>useChartQuerySchedule(query,vi.fn()))!
 scheduler.schedule();scheduler.schedule();scheduler.cancel()
 vi.advanceTimersByTime(200);expect(query).toHaveBeenCalledTimes(1)
 scheduler.schedule();scheduler.schedule();scope.stop()
 vi.advanceTimersByTime(200);expect(query).toHaveBeenCalledTimes(2)
})
