import {collectedOrderNotes} from './collected-order-notes'
it('reads only the order remark, distinguishes missing from explicit empty, and never borrows other notes',()=>{
 expect(collectedOrderNotes({hzkj_note:'  Handle carefully  ',hzkj_shopify_note:'other'})).toEqual({orderRemark:'Handle carefully',orderRemarkProvided:true})
 expect(collectedOrderNotes({hzkj_note:''})).toEqual({orderRemark:'',orderRemarkProvided:true})
 expect(collectedOrderNotes({hzkj_note:null})).toEqual({orderRemark:null,orderRemarkProvided:true})
 expect(collectedOrderNotes({hzkj_shopify_note:'other',hzkj_mulilang_note:'other',hzkj_sku_remark:'other'})).toEqual({orderRemark:null,orderRemarkProvided:false})
})
