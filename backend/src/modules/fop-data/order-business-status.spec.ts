import { aggregatePurchase, orderBusinessStatus, withOrderBusinessStatus } from './order-business-status'
const line=(id:string,status:string,extra:Record<string,any>={})=>({id,hzkj_entrypurc_status:status,hzkj_qty:'2',hzkj_local_sku:{number:'SKU'},...extra})
const project=(lines:any[],extra:Record<string,any>={})=>orderBusinessStatus({id:'10',hzkj_orders_billentry:lines,...extra})
it.each([
 [['unpurchased'],'unpurchased'],[['received','unpurchased'],'partial_received'],
 [['received','shipped'],'partial_received'],[['received','received'],'received'],
 [['shipped','purchased'],'partial_shipped'],[['shipped','shipped'],'shipped'],
 [['purchased','purchasing'],'partial_purchased'],[['purchasing','unpurchased'],'purchasing'],
 [['purchased','purchased'],'purchased'],[['unknown','received'],'unknown'],
] as const)('aggregates highest progressed line %j', (states,want)=>expect(aggregatePurchase([...states])).toBe(want))
it('does not interpret legacy 2 (application audit) as supplier payment',()=>expect(project([line('1','2')]).lines[0].purchase).toBe('purchasing'))
it('uses explicit supplier payment and application creation facts',()=>{
 expect(project([line('1','0',{supplierPaymentStatus:'paid'}),line('2','0',{purchaseApplicationCreated:true})]).lines.map(x=>x.purchase)).toEqual(['purchased','purchasing'])
})
it('full-payment stock use is purchased, never received merely because stock is used',()=>expect(project([line('1','3',{hzkj_use_stock:'1'})]).lines[0].purchase).toBe('purchased'))
it('virtual pending lines do not make a physically completed order partially outbound',()=>{
 const r=project([line('1','3',{hzkj_outbound_status:'1'}),line('2','0',{hzkj_local_sku:{number:'HZ000020-001'},hzkj_outbound_status:'0'})]);expect(r.outbound).toBe('completed');expect(r.purchase).toBe('received')
})
it('excludes virtual by carrier and combination parents identified by child pid',()=>{
 const r=project([line('1','0'),line('2','3',{pid:'1',hzkj_outbound_status:'1'}),line('3','0',{hzkj_local_sku:{hzkj_good:{hzkj_good_carrier:'2'}}})]);expect(r.outbound).toBe('completed')
})
it('all virtual means no physical outbound required, not a shipping completion',()=>expect(project([line('1','0',{hzkj_local_sku:{number:'HZ000020-001'}})]).outbound).toBe('not_required'))
it('missing outbound facts do not copy the possibly incorrect header partial status',()=>expect(project([line('1','2')],{hzkj_delivery_status:'1'}).outbound).toBe('unknown'))
it('partial physical quantity remains partial even if a legacy line flag says complete',()=>expect(project([line('1','3',{hzkj_outbound_qty:'1',hzkj_outbound_status:'1'})]).outbound).toBe('partial'))
it('supports current native fulfillment cancellation code 6 and manual shop classification',()=>{
 expect(project([],{hzkj_orderstatus:'6'}).order).toBe('fulfillment_cancelled')
 expect(project([],{hzkj_shop:{hzkj_shop_class:{number:'Offline'}}}).sourceShipment).toBe('manual')
 expect(project([]).sourceShipment).toBe('unknown')
})
it('uses approval-written inbound quantity for partial receipt without treating a receipt notice as inbound',()=>{
 expect(project([line('1','4',{hzkj_instock_qty:'1'})]).purchase).toBe('partial_received')
 expect(project([line('1','4')]).purchase).toBe('shipped')
})

it('supplies a clear dispatch exception for captured sync failure without changing raw or saving a sticky mark',()=>{
 const display={id:'1',reviewStatus:'approved',exception:null,dispatchDocuments:[{association:{state:'verified'},deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]}
 const raw={id:'1',hzkj_orderstatus:'2'}
 expect(withOrderBusinessStatus(display,raw).exception).toMatchObject({type:'dispatch_exception',reason:expect.stringContaining('同步失败')})
 expect(display.exception).toBeNull();expect(raw.hzkj_orderstatus).toBe('2')
 const recovered={...display,dispatchDocuments:[{...display.dispatchDocuments[0],deliveryStatus:'FULFILLED'}]}
 expect(withOrderBusinessStatus(recovered,{...raw,hzkj_orderstatus:'4'}).exception).toBeNull()
})
