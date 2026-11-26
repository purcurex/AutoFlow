import { normalizeNativeCapture, nativeDispatchTask, scopedPurchaseGroup } from './collected-native-facts'
const parent=(id='10',owner='70')=>({id,billstatus:'C',billno:`TO${id}`,hzkj_org:{id:'100000'},hzkj_operator:{id:owner},hzkj_customer:{id:'80'},hzkj_orders_billentry:[{id:`${id}1`,seq:'1',hzkj_qty:'2',hzkj_purcqty:'2',hzkj_use_stock:'0',hzkj_entrypurc_status:'2',hzkj_local_sku:{id:'50',number:'SKU'}}]})
const page=(facts:any,items:any[]=[parent()])=>({subject:{tenantId:'tenant',userId:'user'},organizationIds:['100000'],workbenchFactsSchemaVersion:1,items,facts})
const opts={companyId:'100000',complete:true,coverage:'full_parent_scan',queue:'procurement'}
it('preserves OpenAPI scalar SKU variants through verified purchase and receipt lines',()=>{
 const p:any=parent();p.hzkj_orders_billentry[0].hzkj_local_sku.hzkj_sku_value='Red / XL'
 const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P20',organizationId:'100000',hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'1',hzkj_qty:'2'}]}],receiptNotices:[{id:'30',billno:'R30',organizationId:'100000',entryentity:[{id:'31',hzkj_qty:'2'}]}],receiptLinks:{31:'21'}},[p])],opts)
 expect(x.entities.find(e=>e.entityType==='purchase')!.display.rows[0].lines[0].variant).toBe('Red / XL')
 expect(x.entities.find(e=>e.entityType==='receipt_notice')!.display.lines[0].variant).toBe('Red / XL')
})
describe('native collected facts',()=>{
 it('keeps blank delivery unknown despite audit and tracking',()=>{expect(nativeDispatchTask([{deliveryStatus:null,status:'approved',trackingNumbers:[{number:'QC'}]}])).toBe('unknown');expect(nativeDispatchTask([])).toBe('dispatch_missing');expect(nativeDispatchTask([{deliveryStatus:'FULFILLED'}])).toBe('dispatch_synced');expect(nativeDispatchTask([{deliveryStatus:'SYNC_FAILED'}])).toBe('unknown')})
 it('deduplicates entities and keeps conflicting versions quarantined',()=>{const d={id:'20',billno:'P20',organizationId:'100000',hzkj_order_no:'TO10',billstatus:'C'};const x=normalizeNativeCapture([page({dispatches:[d],purchases:[],receiptNotices:[]}),page({dispatches:[{...d,billstatus:'A'}],purchases:[],receiptNotices:[]})],opts);expect(x.entities.filter(e=>e.entityType==='dispatch')).toHaveLength(1);expect(x.entities.find(e=>e.entityType==='dispatch')?.display.association.state).toBe('conflict');expect(x.parents.get('10')?.dispatchTaskStatus).toBe('unknown')})
 it('does not replace missing supplier shipment with receive quantities; maps actual purchase and explicit receipt links',()=>{const p={id:'20',billno:'P20',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'1',hzkj_purchase_channel:'1',hasAlibabaOffer:true,hzkj_1688_order_n:'alibaba',hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'1',hzkj_qty:'2',hzkj_receiveqty:'6'}]};const x=normalizeNativeCapture([page({purchases:[p],receiptNotices:[{id:'30',billno:'R30',organizationId:'100000',entryentity:[{id:'31',hzkj_qty:'2'}]}],receiptLinks:{31:'21'},dispatches:[]})],opts);const g=x.entities.find(e=>e.entityType==='purchase')!.display;expect(g.shippedQuantity).toBeNull();expect(g.shipment).toBe('pending');expect(g.rows[0].ownerEmployeeId).toBe('70');expect(x.entities.find(e=>e.entityType==='receipt_notice')!.display.status).toBe('unknown');expect(x.entities.find(e=>e.entityType==='receipt_notice')!.display.lines[0]).toMatchObject({sku:'SKU',quantity:2,productSource:'verified_receipt_purchase_fulfillment_link'});expect(x.entities.find(e=>e.entityType==='receipt_notice')!.display.supplier).toBeNull();expect(x.entities.find(e=>e.entityType==='receipt_notice')!.display.warehouse).toBeNull()})
 it('rejects cross-company facts and never grants ownership from purchase operators',()=>{expect(()=>normalizeNativeCapture([page({purchases:[{id:'20',organizationId:'OTHER'}]})],opts)).toThrow('company');const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P',organizationId:'100000',hzkj_operator:{id:'70'},hzkj_billentry:[{id:'21',hzkj_qty:'2',hzkj_salbillnumber:'MISSING'}]}]})],opts);expect(x.entities[0].display.rows[0].ownerEmployeeId).toBeNull();expect(scopedPurchaseGroup(x.entities[0].display,['70']).rows).toEqual([])})
 it('scopes shared groups before totals and details, never exposes other owners',()=>{const g={id:'purchase:20',purchase:{number:'P'},rows:[{orderId:'10',orderNumber:'TO10',ownerEmployeeId:'70',lines:[{sku:'A',quantity:2,shippedQuantity:null}]},{orderId:'11',orderNumber:'TO11',ownerEmployeeId:'71',lines:[{sku:'B',quantity:5,shippedQuantity:null}]}]};const s=scopedPurchaseGroup(g,['70']);expect(s.quantity).toBe(2);expect(s.orderCount).toBe(1);expect(s.rows).toHaveLength(1);expect(s.shippedQuantity).toBeNull()})
})

it('merges page-scoped purchase lines without conflicting headers and is repeatable',()=>{const head={id:'20',billno:'P',organizationId:'100000',hzkj_cancelstatus:'A'};const a=page({purchases:[{...head,hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'1',hzkj_qty:'2'}]}]},[parent()]);const b=page({purchases:[{...head,hzkj_billentry:[{id:'22',hzkj_salbillnumber:'TO11',hzkj_srcbillentryseq:'1',hzkj_qty:'3'}]}]},[parent('11','71')]);const x=normalizeNativeCapture([a,b],opts),twice=normalizeNativeCapture([a,b,a,b],opts);expect(x.diagnostics.conflictCount).toBe(0);expect(x.entities.find(e=>e.entityType==='purchase')?.display.quantity).toBe(5);expect(x.entities).toEqual(twice.entities)})
it('derives positive uncreated demand and excludes virtual and stock-covered lines',()=>{const p=parent();p.hzkj_orders_billentry[0].hzkj_purcqty='0';p.hzkj_orders_billentry[0].hzkj_entrypurc_status='0';const raw={...p,hzkj_receipt_status:'1',hzkj_orderstatus:'1'};const x=normalizeNativeCapture([page({purchases:[]},[raw])],opts);expect(x.entities.find(e=>e.entityType==='purchase_demand')?.display.quantity).toBe(2);expect(x.parents.get('10')?.procurementStage).toBe('purchase_order_pending');const virtual=normalizeNativeCapture([page({purchases:[],products:[{id:'50',organizationId:null,hzkj_good:{hzkj_good_carrier:'2'}}]},[raw])],opts);expect(virtual.parents.get('10')?.procurementStage).toBe('not_required');expect(virtual.entities.some(e=>e.entityType==='purchase_demand')).toBe(false)})
it('requires proven warehouse readiness and does not release an unknown interception',()=>{const raw={...parent(),hzkj_delivery_status:'0'};const x=normalizeNativeCapture([page({allocations:[{id:'30',organizationId:'100000',billno:'A30',hzkj_order_id:'10',billstatus:'C',hzkj_alloc_status:'completed'}],dispatches:[{id:'40',organizationId:'100000',billno:'D40',hzkj_order_no:'TO10',billstatus:'C',hzkj_delivery_status:'PENDING'}]},[raw])],{...opts,queue:'allocation'});expect(x.parents.get('10')?.nativeShippingReady).toBe(true);expect(x.parents.get('10')?.shipmentInterceptStatus).toBeUndefined();expect(x.parents.get('10')?.nativeFulfillmentProgress.outbound).toBe('pending')})

it('zero accumulated purchased quantity is not proof of no purchase requirement',()=>{const p=parent();p.hzkj_orders_billentry[0].hzkj_purcqty='0';p.hzkj_orders_billentry[0].hzkj_entrypurc_status='0';const x=normalizeNativeCapture([page({purchases:[]},[{...p,hzkj_receipt_status:'1',hzkj_orderstatus:'1'}])],opts);expect(x.parents.get('10')?.procurementStage).toBe('purchase_order_pending');expect(x.parents.get('10')?.procurementProgress.purchaseOrder).not.toBe('not_required')})

it('does not manufacture absent purchase demand when a known parent has an unresolved purchase line',()=>{const p:any=parent();p.hzkj_receipt_status='1';p.hzkj_orderstatus='1';p.hzkj_orders_billentry[0].hzkj_purcqty='0';p.hzkj_orders_billentry[0].hzkj_entrypurc_status='0';const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P',organizationId:'100000',hzkj_billentry:[{id:'21',hzkj_qty:'2',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'MISSING'}]}]},[p])],opts);expect(x.entities.some(e=>e.entityType==='purchase_demand')).toBe(false);expect(x.parents.get('10')?.procurementStage).toBe('unknown')})
it('quarantines conflicted purchase ownership transitively before receipt product and owner projection',()=>{
 const a=parent(),b=parent('11','71'),line=(number:string)=>({id:'21',hzkj_salbillnumber:number,hzkj_srcbillentryseq:'1',hzkj_qty:'2'}),header={id:'20',billno:'P20',organizationId:'100000'}
 const x=normalizeNativeCapture([page({purchases:[{...header,hzkj_billentry:[line('TO10')]}],receiptLinks:{31:'21'},receiptNotices:[{id:'30',billno:'R30',organizationId:'100000',entryentity:[{id:'31',hzkj_qty:'2'}]}]},[a,b]),page({purchases:[{...header,hzkj_billentry:[line('TO11')]}]},[a,b])],opts)
 const purchase=x.entities.find(e=>e.entityType==='purchase')!.display,receipt=x.entities.find(e=>e.entityType==='receipt_notice')!.display
 expect(purchase.association.state).toBe('conflict');expect(scopedPurchaseGroup(purchase,['70']).rows).toEqual([]);expect(scopedPurchaseGroup(purchase,['71']).rows).toEqual([])
 expect(receipt.association.state).toBe('unresolved');expect(receipt.ownerEmployeeIds).toEqual([]);expect(receipt.lines[0].sku).toBeNull()
 expect(x.parents.get('10')?.nativeProcurementAssociationIssues).toContain('purchase_relationship_unresolved');expect(x.parents.get('11')?.procurementStage).toBe('unknown')
})
it('does not infer no dispatch from a rejected customer relation',()=>{
 const x=normalizeNativeCapture([page({dispatches:[{id:'30',billno:'D30',organizationId:'100000',hzkj_order_no:'TO10',hzkj_customer:{id:'999'},billstatus:'C',hzkj_delivery_status:'PENDING'}]})],{...opts,queue:'allocation'})
 expect(x.parents.get('10')?.dispatchTaskStatus).toBe('unknown');expect(x.parents.get('10')?.nativeAssociationIssues).toContain('dispatch_relationship_conflict');expect(x.parents.get('10')?.nativeShippingReady).toBe(false)
})
it('marks every potentially related parent for ambiguous source order numbers without granting ownership',()=>{
 const a:any=parent(),b:any=parent('11','71');b.billno='TO10';for(const p of [a,b]){p.hzkj_receipt_status='1';p.hzkj_orderstatus='1';p.hzkj_orders_billentry[0].hzkj_purcqty='0'}
 const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P20',organizationId:'100000',hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'1',hzkj_qty:'2'}]}],dispatches:[{id:'30',billno:'D30',organizationId:'100000',hzkj_order_no:'TO10'}]},[a,b])],opts)
 expect(x.entities.some(e=>e.entityType==='purchase_demand')).toBe(false);for(const p of[a,b]){expect(x.parents.get(p.id)?.procurementStage).toBe('unknown');expect(x.parents.get(p.id)?.dispatchTaskStatus).toBe('unknown')}
})
it('retains cancelled dispatch evidence but removes it from both effective logistics and warehouse readiness',()=>{
 const x=normalizeNativeCapture([page({allocations:[{id:'40',billno:'A40',organizationId:'100000',hzkj_order_id:'10',billstatus:'C',hzkj_alloc_status:'completed'}],dispatches:[{id:'30',billno:'D30',organizationId:'100000',hzkj_order_no:'TO10',billstatus:'C',hzkj_delivery_status:'PENDING',hzkj_ship_block_state:'CANCELLED',hzkj_logistics_orderno:'QC',hzkj_logistics_trackno:'WC'}]})],{...opts,queue:'allocation'})
 const p=x.parents.get('10')!;expect(p.nativeShippingReady).toBe(false);expect(p.dispatchLogistics).toEqual([]);expect(p.warehouseLogistics).toEqual([]);expect(p.dispatchDocuments[0].trackingNumbers).toHaveLength(2);expect(p.dispatchTaskStatus).toBe('dispatch_pending')
})
it('treats duplicate source entry sequences as an ambiguous allocation, not missing purchase demand',()=>{const p:any=parent();p.hzkj_receipt_status='1';p.hzkj_orderstatus='1';p.hzkj_orders_billentry[0].hzkj_purcqty='0';p.hzkj_orders_billentry.push({...p.hzkj_orders_billentry[0],id:'102'});const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P20',organizationId:'100000',hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentryseq:'1',hzkj_qty:'2'}]}]},[p])],opts);expect(x.entities.some(e=>e.entityType==='purchase_demand')).toBe(false);expect(x.parents.get('10')?.nativeProcurementAssociationIssues).toEqual([]);expect(x.entities.find(e=>e.entityType==='purchase')?.display.rows[0]).toMatchObject({orderId:'10',associationState:'verified'})})
it('uses line state instead of a contradictory fulfillment header',()=>{
 const p:any=parent();p.hzkj_purchase_status='3';p.hzkj_orders_billentry[0].hzkj_entrypurc_status='0'
 const x=normalizeNativeCapture([page({purchases:[]},[p])],opts)
 expect(x.parents.get('10')?.procurementStage).toBe('purchase_order_pending')
})


it('keeps actual channel and typed tracking together per dispatch without borrowing provider or quotation',()=>{
 const dispatch=(id:string,channel:any)=>({id,billno:'FY'+id,organizationId:'100000',hzkj_order_no:'TO10',billstatus:'C',hzkj_delivery_status:'LOCAL_ONLY',hzkj_logistics_channel1:channel,hzkj_logistics_providers:{name:'Provider'},hzkj_logistics_orderno:'00'+id,hzkj_logistics_trackno:'WC'+id})
 const x=normalizeNativeCapture([page({dispatches:[dispatch('30',{name:'Actual channel',number:'CH01',hzkj_channel_code:'API01'}),dispatch('31',null)]})],opts)
 const p=x.parents.get('10')!
 expect(p.dispatchDocuments[0]).toMatchObject({channelName:'Actual channel',channelCode:'CH01'})
 const groups=[{channelName:'Actual channel',channelCode:'CH01',trackingNumbers:[{type:'full',number:'0030'},{type:'last_mile',number:'WC30'}]},{channelName:null,channelCode:null,trackingNumbers:[{type:'full',number:'0031'},{type:'last_mile',number:'WC31'}]}]
 expect(p.dispatchLogistics).toEqual(groups)
 expect(p.warehouseLogistics).toEqual(groups)
})

it('links purchase rows by the unique sales order number even without fulfillment entry identifiers',()=>{
 const p:any=parent();p.hzkj_purchase_status='4';
 const x=normalizeNativeCapture([page({purchases:[{id:'20',billno:'P20',organizationId:'100000',hzkj_billentry:[{id:'21',hzkj_salbillnumber:'TO10',hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'900',hzkj_qty:'2',hzkj_material:{number:'PUR-SKU'}}]}]},[p])],opts)
 const g=x.entities.find(e=>e.entityType==='purchase')!.display
 expect(g.rows[0]).toMatchObject({orderId:'10',ownerEmployeeId:'70',associationState:'verified'})
 expect(g.rows[0].lines[0]).toMatchObject({fulfillmentLineId:null,sku:'PUR-SKU',quantity:2})
 expect(x.parents.get('10')?.nativeProcurementAssociationIssues).toEqual([])
 expect(x.parents.get('10')).toMatchObject({procurementStage:'supplier_pending',businessStatus:{purchase:'shipped',lines:[{purchase:'purchased'}]},procurementProgress:{supplierPayment:'unknown'}})
})
