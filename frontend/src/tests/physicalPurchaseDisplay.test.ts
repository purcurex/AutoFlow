import {describe,it,expect} from 'vitest'
import {completedPurchaseLabel} from '@/utils/fulfillment-source-status'
describe('physical-only purchase display',()=>{
 const order={sourcePurchaseStatus:'1',sourcePurchaseStatusName:'部分采购',businessStatus:{purchase:'received'},items:[{isVirtual:false},{isVirtual:true}]}
 it('does not display a virtual-polluted partial header in completed lists',()=>expect(completedPurchaseLabel(order,true)).toBe('已入库'))
 it('preserves native display for physical-only orders',()=>expect(completedPurchaseLabel({...order,items:[{isVirtual:false}]},true)).toBe('部分采购'))
 it('does not invent a physical aggregate when missing',()=>expect(completedPurchaseLabel({...order,businessStatus:undefined},true)).toBe('待确认'))
})
