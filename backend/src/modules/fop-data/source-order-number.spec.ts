import {sourceOrderNumber,withSourceOrderNumber} from './source-order-number'
const raw=(patch:Record<string,unknown>={})=>({id:'1',hzkj_source_number:'',hzkj_sourceid:'',hzkj_eplatform:{name:'Offline Store'},...patch})
it.each(['',null,'   '])('uses the label only for explicit empty source fields (%p)',value=>expect(sourceOrderNumber(raw({hzkj_source_number:value,hzkj_sourceid:value}))).toEqual({shopifyOrderNumber:'手工订单',sourceOrderNumberIsManual:true}))
it('preserves source numbers and refuses platform or ID guesses',()=>{
 expect(sourceOrderNumber(raw({hzkj_source_number:'#123'}))).toEqual({shopifyOrderNumber:'#123',sourceOrderNumberIsManual:false})
 for(const patch of [{hzkj_sourceid:'123'},{hzkj_sourceid:0},{hzkj_sourceid:undefined},{hzkj_eplatform:{name:'Shopify'}},{hzkj_eplatform:null},{hzkj_source_number:undefined}])expect(sourceOrderNumber(raw(patch)).sourceOrderNumberIsManual).toBe(false)
 const noId=raw();delete (noId as any).hzkj_sourceid;expect(sourceOrderNumber(noId).sourceOrderNumberIsManual).toBe(false)
})
it('does not modify raw facts, affect status, or attach a different order',()=>{
 const source=raw(),display={id:'1',shopifyOrderNumber:'',businessStatus:{sourceShipment:'unknown',order:'fulfilled'}}
 expect(withSourceOrderNumber(display,source)).toMatchObject({shopifyOrderNumber:'手工订单',businessStatus:display.businessStatus})
 expect(source.hzkj_source_number).toBe('');expect(display.shopifyOrderNumber).toBe('')
 expect(withSourceOrderNumber(display,{...source,id:'other'})).toBe(display)
 expect(sourceOrderNumber({id:'1'},'#existing').shopifyOrderNumber).toBe('#existing')
})
