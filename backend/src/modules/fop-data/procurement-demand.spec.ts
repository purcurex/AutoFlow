import { pendingPurchaseStage as stage, usesReservedStock } from './procurement-demand'
const parent={id:'O',billstatus:'C',hzkj_orderstatus:'2'},demand=[{purchase:'purchasing'}]
const purchase=(raw:any={})=>({raw:{hzkj_cancelstatus:'A',hzkj_purchase_channel:'1',hzkj_pay_status:'0',...raw},display:{rows:[{orderId:'O',associationState:'verified'}]}})
it('requires approval and unpurchased demand and no effective purchase for creation',()=>{
 expect(stage(parent,demand,[],[])).toBe('purchase_order_pending')
 expect(stage({...parent,billstatus:'A'},demand,[],[])).toBeNull()
 expect(stage({...parent,hzkj_orderstatus:'0'},demand,[],[])).toBeNull()
 for(const purchase of ['purchased','shipped','partial_received','received'])expect(stage(parent,[{purchase}],[],[])).toBeNull()
})
it('requires known absent dispatch, not merely a missing tracking number',()=>{
 expect(stage(parent,demand,[purchase()],[])).toBe('dispatch_preparation')
 expect(stage(parent,demand,[purchase()],undefined)).toBeNull()
 expect(stage(parent,demand,[purchase()],[{number:'FY1',association:{state:'verified'}}])).toBeNull()
})
it('requires an actual 1688 number and explicit unpaid value, and excludes refunds',()=>{
 expect(stage(parent,demand,[purchase({hzkj_1688_order_n:'1688'})],[])).toBe('payment_pending')
 expect(stage(parent,demand,[purchase({hzkj_pay_status:'3'})],[])).toBeNull()
 expect(stage(parent,demand,[purchase({hzkj_pay_status:null})],[])).toBeNull()
})
it('recognizes actual full-payment and deposit stock usage without treating zero or absent quantities as usage',()=>{
 expect(usesReservedStock({hzkj_use_stock:'1'})).toBe(true)
 expect(usesReservedStock({hzkj_deposit_use_qty:'1'})).toBe(true)
 expect(usesReservedStock({hzkj_deposit_use_qty:'0'})).toBe(false)
 expect(usesReservedStock({})).toBe(false)
})
