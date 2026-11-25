import {describe,it,expect} from 'vitest'
import {completedPurchaseLabel} from '@/utils/fulfillment-source-status'
describe('fixed native header purchase display',()=>{
 const order={sourcePurchaseStatus:'1',sourcePurchaseStatusName:'部分采购',businessStatus:{purchase:'received'},items:[{isVirtual:false},{isVirtual:true}]}
 it.each([true,false])('does not switch field with role or virtual items (%s)',native=>{
  expect(completedPurchaseLabel(order,native)).toBe('部分采购')
  expect(completedPurchaseLabel({...order,items:[{isVirtual:false}]},native)).toBe('部分采购')
 })
 it('leaves missing source blank rather than using derived state',()=>expect(completedPurchaseLabel({...order,sourcePurchaseStatus:undefined},true)).toBe(''))
 it('does not reuse a Chinese source title in English',()=>expect(completedPurchaseLabel(order,true,true)).toBe('Partly purchased'))
})
