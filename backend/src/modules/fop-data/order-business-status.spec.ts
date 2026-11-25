import { aggregatePurchase, orderBusinessStatus, withOrderBusinessStatus } from './order-business-status'
const line=(id:string,status:string,extra:Record<string,any>={})=>({id,hzkj_entrypurc_status:status,hzkj_qty:'2',hzkj_local_sku:{number:'SKU'},...extra})
const project=(lines:any[],extra:Record<string,any>={})=>orderBusinessStatus({id:'10',hzkj_orders_billentry:lines,...extra})
it.each([
 [['unpurchased'],'unpurchased'],[['received','unpurchased'],'partial_received'],
 [['received','shipped'],'partial_received'],[['received','received'],'received'],
 [['shipped','purchased'],'partial_shipped'],[['shipped','shipped'],'shipped'],
 [['purchased','purchasing'],'partial_purchased'],[['purchasing','unpurchased'],'purchasing'],
 [['purchased','purchased'],'purchased'],[['unknown','received'],'partial_received'],
] as const)('aggregates highest progressed line %j', (states,want)=>expect(aggregatePurchase([...states])).toBe(want))
it.each([['0','unpurchased'],['1','purchasing'],['2','purchased'],['3','received'],['4','shipped']])('uses native SKU purchase status %s', (value,state)=>{
 const result=project([line('1',value,{supplierPaymentStatus:'paid',hzkj_instock_qty:'1',hzkj_use_stock:'1'})])
 expect(result.lines[0].purchase).toBe(state)
})
it('header purchase and outbound states take precedence over mixed item quantities',()=>{
 const result=project([line('1','3',{hzkj_outbound_qty:'1'}),line('2','0')],{hzkj_purchase_status:'2',hzkj_delivery_status:'2'})
 expect(result.purchase).toBe('purchased');expect(result.outbound).toBe('completed')
 expect(project([line('1','3')],{hzkj_purchase_status:'1',hzkj_delivery_status:'0'})).toMatchObject({purchase:'partial_purchased',outbound:'pending'})
})
it('missing header states remain unknown rather than inheriting item progress',()=>{
 expect(project([line('1','3',{hzkj_outbound_qty:'2'})])).toMatchObject({purchase:'unknown',outbound:'unknown'})
})
it('uses native source shipment only, independent of shop type and fulfillment completion',()=>{
 expect(project([],{hzkj_orderstatus:'6'}).order).toBe('fulfillment_cancelled')
 expect(project([],{hzkj_shop:{hzkj_shop_class:{number:'Offline'}}}).sourceShipment).toBe('unknown')
 expect(project([],{hzkj_fulfillment_status:'fulfilled',hzkj_shop:{hzkj_shop_class:{number:'Offline'}}}).sourceShipment).toBe('fulfilled')
 expect(project([],{hzkj_fulfillment_status:'',hzkj_orderstatus:'4'}).sourceShipment).toBe('unfulfilled')
 expect(project([],{hzkj_fulfillment_status:'manual'}).sourceShipment).toBe('manual')
 expect(project([],{hzkj_fulfillment_status:' 新状态 '}).sourceShipment).toBe('新状态')
 expect(project([]).sourceShipment).toBe('unknown')
})
it('supplies a clear dispatch exception for captured sync failure without changing raw or saving a sticky mark',()=>{
 const display={id:'1',reviewStatus:'approved',exception:null,dispatchDocuments:[{association:{state:'verified'},deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]}
 const raw={id:'1',hzkj_orderstatus:'2'}
 expect(withOrderBusinessStatus(display,raw).exception).toMatchObject({type:'dispatch_exception',reason:expect.stringContaining('同步失败')})
 expect(display.exception).toBeNull();expect(raw.hzkj_orderstatus).toBe('2')
 const recovered={...display,dispatchDocuments:[{...display.dispatchDocuments[0],deliveryStatus:'FULFILLED'}]}
 expect(withOrderBusinessStatus(recovered,{...raw,hzkj_orderstatus:'4',hzkj_logistics_info:[{hzkj_tracking_number:'TRACK'}]}).exception).toBeNull()
})

it('classifies missing fulfilled package tracking, retains native status and clears the derived exception after recovery',()=>{
 const raw={id:'1',hzkj_orderstatus:'4',hzkj_logistics_info:[{hzkj_tracking_number:'  '}]}
 const display={id:'1',reviewStatus:'approved',logisticsInfo:[{packageTrackingNumber:'OLD'}]}
 const missing=withOrderBusinessStatus(display,raw)
 expect(missing.businessStatus.order).toBe('fulfilled')
 expect(missing.exception).toMatchObject({type:'dispatch_exception',reason:'履约订单物流跟踪号为空'})
 expect(withOrderBusinessStatus(missing,{...raw,hzkj_logistics_info:[{hzkj_tracking_number:'NEW'}]}).exception).toBeNull()
 expect(withOrderBusinessStatus(display,{...raw,hzkj_orderstatus:'3'}).exception).toBeUndefined()
})

it('reports obtained-without-number, recovers after the same dispatch gets its number, and leaves other stages unchanged',()=>{
 const raw={id:'1',hzkj_orderstatus:'3',hzkj_fulfillment_status:'unfulfilled'}
 const display={id:'1',reviewStatus:'approved',exception:null,dispatchDocuments:[{number:'FY1',deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[] as {type:string;number:string}[]}]}
 const missing=withOrderBusinessStatus(display,raw)
 expect(missing.exception).toMatchObject({type:'dispatch_exception',reason:'已取号订单缺少物流跟踪号'})
 expect(missing.businessStatus.order).toBe('processing')
 const restored=withOrderBusinessStatus({...missing,dispatchDocuments:[{number:'FY1',deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[{type:'full',number:'CURRENT'}]}]},raw)
 expect(restored.exception).toBeNull()
 expect(restored.dispatchTaskStatus).toBe('dispatch_tracking')
 expect(withOrderBusinessStatus({...display,reviewStatus:'pending'},raw).exception).toBeNull()
 expect(withOrderBusinessStatus(display,{...raw,hzkj_orderstatus:'6'}).exception).toMatchObject({type:'logistics_exception',reason:'取消履约'})
})

it('clears derived cancellation after restoration and does not confuse dispatch cancellation',()=>{
 const raw={id:'1',hzkj_orderstatus:'6'}
 const cancelled=withOrderBusinessStatus({id:'1',reviewStatus:'approved',dispatchDocuments:[]},raw)
 expect(cancelled.exception).toMatchObject({type:'logistics_exception',reason:'取消履约'})
 expect(withOrderBusinessStatus(cancelled,{...raw,hzkj_orderstatus:'2'}).exception).toBeNull()
 expect(withOrderBusinessStatus({id:'1',reviewStatus:'approved',dispatchDocuments:[{number:'FY',deliveryStatus:'CANCELLED',trackingNumbers:[]}]},{...raw,hzkj_orderstatus:'2'}).exception).toBeUndefined()
})
it('retains both native dispatch failure and missing package facts with precise reasons',()=>{
 const raw={id:'1',billstatus:'C',hzkj_orderstatus:'4',hzkj_receipt_status:'1',hzkj_logistics_info:[]}
 const display={id:'1',reviewStatus:'approved',dispatchDocuments:[{deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'QC'}]}]}
 expect(withOrderBusinessStatus(display,raw).exception.reason).toBe('发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
 expect(withOrderBusinessStatus({id:'1',reviewStatus:'approved'},{...raw,hzkj_logistics_info:undefined}).exception.reason).toBe('履约订单物流信息待核验')
})
