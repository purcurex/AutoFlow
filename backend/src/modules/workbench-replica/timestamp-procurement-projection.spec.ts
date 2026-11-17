import { timestampProcurementProjection as project } from './timestamp-procurement-projection'
const parent={id:'1',hzkj_orders_billentry:[{id:'11',hzkj_qty:'2'}]}
const purchase=(raw:Record<string,any>={},qty='2',state='verified')=>({raw:{hzkj_cancelstatus:'A',hzkj_pay_status:'1',hzkj_purchase_channel:'2',hzkj_ship_status:'0',...raw},display:{rows:[{orderId:'1',associationState:state,lines:[{fulfillmentLineId:'11',quantity:qty}]}]}})
it('keeps payment, platform placement and refund actions proven by independent purchase documents',()=>{
 expect(project(parent,[purchase({hzkj_pay_status:'0'})]).procurementStage).toBe('payment_pending')
 expect(project(parent,[purchase({hzkj_purchase_channel:'1',hasAlibabaOffer:true})]).procurementStage).toBe('alibaba_pending')
 expect(project(parent,[purchase({hzkj_pay_status:'3'})]).procurementStage).toBe('refund_pending')
})
it('requires current line coverage before deriving supplier shipment stages',()=>{
 expect(project(parent,[purchase()]).procurementStage).toBe('supplier_pending')
 expect(project(parent,[purchase({hzkj_ship_status:'1'})]).procurementStage).toBe('shipped')
 expect(project(parent,[purchase({hzkj_ship_status:'1'},'1')]).procurementStage).toBe('unknown')
 expect(project(parent,[purchase({hzkj_ship_status:'1'},'2','unresolved')]).procurementStage).toBe('unknown')
})
it('does not invent absent demand, shipment, purchase or old header facts',()=>{
 expect(project(parent,[])).toMatchObject({nativeProcurementCaptured:false,procurementStage:'unknown',nativeSupplierShipment:'unknown'})
 expect(project(parent,[purchase({hzkj_ship_status:null})]).nativeSupplierShipment).toBe('unknown')
 expect(project({...parent,hzkj_orders_billentry:[{id:'11'}]},[purchase()]).procurementStage).toBe('unknown')
})

it('excludes explicitly stocked, virtual and split parent lines using current source facts',()=>{
 const mixed={...parent,hzkj_orders_billentry:[{id:'20',hzkj_qty:'5',hzkj_use_stock:'1'},{id:'30',hzkj_qty:'1',hzkj_local_sku:{number:'HZ000020-001'}},{id:'40',hzkj_qty:'8'},{id:'11',pid:'40',hzkj_qty:'2'}]}
 expect(project(mixed,[purchase({hzkj_ship_status:'1'})]).procurementStage).toBe('shipped')
})
