import { expect, it } from 'vitest'
import { registrationAxis } from '@/utils/registration-axis'
import type { LocalAnalyticsResult } from '@/api/local-dashboard-analytics'
const result=(day:number,month:number)=>({rows:[{dimension:'day',registrationCount:day},{dimension:'month',registrationCount:month}]} as LocalAnalyticsResult)
it('keeps integer ticks for empty and small counts',()=>{
 expect(registrationAxis(undefined,'day')).toEqual({min:0,max:1,interval:1})
 expect(registrationAxis(result(4,80),'day')).toEqual({min:0,max:5,interval:1})
})
it('recalculates bounds for a new period or dimension without clipping',()=>{
 expect(registrationAxis(result(17,80),'day')).toEqual({min:0,max:20,interval:5})
 expect(registrationAxis(result(17,80),'month')).toEqual({min:0,max:100,interval:20})
})
it('includes the previous comparison period in the reference scale',()=>{
 const data=result(2,5)
 data.comparison={previousData:result(23,60)} as LocalAnalyticsResult['comparison']
 expect(registrationAxis(data,'day')).toEqual({min:0,max:25,interval:5})
})

it('adds a tick above an exact maximum and does not force five ticks for small data',()=>{
 expect(registrationAxis(result(1,0),'day')).toEqual({min:0,max:2,interval:1})
 expect(registrationAxis(result(2,0),'day')).toEqual({min:0,max:3,interval:1})
 expect(registrationAxis(result(5,0),'day')).toEqual({min:0,max:6,interval:1})
 expect(registrationAxis(result(20,0),'day')).toEqual({min:0,max:25,interval:5})
})
