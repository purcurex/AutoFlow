import {describe,it,expect} from 'vitest'
import {workbenchTimeRange} from '@/utils/workbench-time-range'
describe('workbench payment range defaults',()=>{
 it.each([undefined,null,'','invalid'])('defaults missing or invalid %s to three months',value=>{expect(workbenchTimeRange(value)).toBe('3m');expect(workbenchTimeRange(value,true)).toBe('3m')})
 it.each(['1w','1m','3m'] as const)('preserves explicit %s',value=>expect(workbenchTimeRange(value)).toBe(value))
 it('preserves all only where allowed',()=>{expect(workbenchTimeRange('all',true)).toBe('all');expect(workbenchTimeRange('all')).toBe('3m')})
})
