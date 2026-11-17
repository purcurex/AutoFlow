import { afterEach, expect, it, vi } from 'vitest'
import { businessYears } from '@/utils/business-years'
afterEach(()=>vi.useRealTimers())
it('starts at 2026 and adds a year only when the UTC+8 calendar reaches it',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-31T15:59:59Z'))
 expect(businessYears()).toEqual([2026])
 vi.setSystemTime(new Date('2026-12-31T16:00:00Z'))
 expect(businessYears()).toEqual([2027,2026])
 expect(businessYears(2032)).toEqual([2032,2031,2030,2029,2028,2027,2026])
})
