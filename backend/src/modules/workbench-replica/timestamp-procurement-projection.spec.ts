import { timestampProcurementProjection as project } from './timestamp-procurement-projection'
const line=(id:string,status:string,extra:any={})=>({id,hzkj_entrypurc_status:status,hzkj_qty:'2',...extra})
const parent=(lines:any[],extra:any={})=>({id:'1',billstatus:'C',hzkj_orderstatus:'2',hzkj_orders_billentry:lines,...extra})
const purchase=(raw:any={},state='verified')=>({raw:{hzkj_cancelstatus:'A',hzkj_pay_status:'1',hzkj_purchase_channel:'1',hasAlibabaOffer:true,hzkj_1688_order_n:'1688',...raw},display:{rows:[{orderId:'1',associationState:state,lines:[{fulfillmentLineId:'11',quantity:'1'}]}]}})
it('payment establishes purchased without requiring full line quantity; application alone is purchasing',()=>{
 expect(project(parent([line('11','2')]),[]).businessStatus.purchase).toBe('purchasing')
 expect(project(parent([line('11','2')]),[purchase()])).toMatchObject({businessStatus:{purchase:'purchased'},procurementStage:'supplier_pending',procurementQueueFlags:{shipping:true,pending:false}})
})
it('does not infer receipt-notice approval from supplier logistics or override lines with header',()=>{
 expect(project(parent([line('11','2')],{hzkj_purchase_status:'3'}),[purchase({hzkj_ship_status:'1'})]).businessStatus.purchase).toBe('purchased')
 expect(project(parent([line('11','4')],{hzkj_purchase_status:'0'}),[])).toMatchObject({businessStatus:{purchase:'shipped'},procurementQueueFlags:{completed:true}})
})
it('highest line stage wins while outstanding purchasing and shipping tasks may coexist',()=>{
 const r=project(parent([line('11','2'),line('12','0'),line('13','3')]),[purchase()])
 expect(r.businessStatus.purchase).toBe('partial_received');expect(r.procurementQueueFlags).toEqual({pending:false,shipping:true,completed:false})
})
it('only full ledger coverage suppresses supplier work; a selection flag never overrides receipt',()=>{
 expect(project(parent([line('11','3',{hzkj_use_stock:'1',procurementSource:{complete:true,directQuantity:'0'}})]),[])).toMatchObject({businessStatus:{purchase:'received'},procurementStage:'not_required',procurementQueueFlags:{pending:false,shipping:false,completed:false}})
 expect(project(parent([line('11','2')],{hzkj_orderstatus:'0'}),[purchase()])).toMatchObject({procurementStage:'cancelled',procurementQueueFlags:{pending:false,shipping:false,completed:false}})
})
it('unresolved or cancelled purchase links cannot prove payment; missing facts remain unknown',()=>{
 expect(project(parent([line('11','2')]),[purchase({},'unresolved')]).businessStatus.purchase).toBe('purchasing')
 expect(project(parent([line('11','2')]),[purchase({hzkj_cancelstatus:'B'})]).businessStatus.purchase).toBe('purchasing')
 expect(project(parent([line('11','')]),[]).businessStatus.purchase).toBe('unknown')
})
it('a saved active application starts purchasing before approval, using source entry sequence',()=>{
 const p=parent([line('11','0',{seq:1})],{billno:'O1'})
 const application={hzkj_cancelstatus:'A',billstatus:'A',entryentity:[{hzkj_srcbillnumber:'O1',hzkj_srcbillentryseq:'1'}]}
 expect(project(p,[],[application]).businessStatus.purchase).toBe('purchasing')
 expect(project(p,[],[{...application,hzkj_cancelstatus:'B'}]).businessStatus.purchase).toBe('unpurchased')
})
it('excludes fully covered deposit demand based on records rather than a line quantity hint',()=>{
 const r=project(parent([line('11','2',{hzkj_deposit_use_qty:'2',procurementSource:{complete:true,directQuantity:'0'}})]),[])
 expect(r.procurementQueueFlags.pending).toBe(false);expect(r.procurementStage).toBe('not_required')
})
it('partial stock usage keeps the paid direct-purchase remainder in supplier pending',()=>{
 const r=project(parent([line('11','2',{hzkj_use_stock:'1',hzkj_deposit_use_qty:'1',procurementSource:{complete:true,demandQuantity:'2',directQuantity:'1',lineIds:['11']}})]),[purchase()])
 expect(r.procurementQueueFlags.shipping).toBe(true)
 expect(r.timestampProcurementBasis.lineCoverageVerified).toBe(true)
})
it.each([
 [[{fulfillmentLineId:'11',quantity:'6'}],true],
 [[{fulfillmentLineId:'12',quantity:'6'}],true],
 [[{fulfillmentLineId:'11',quantity:'2'},{fulfillmentLineId:'12',quantity:'4'}],true],
 [[{fulfillmentLineId:'11',quantity:'5'}],false],
 [[{fulfillmentLineId:'11',quantity:'6'},{fulfillmentLineId:'12',quantity:null}],false],
])('verifies repeated-SKU direct demand once without allocating stock to original lines (%j)',(purchased,covered)=>{
 const procurementSource={skuId:'sku-1',complete:true,demandQuantity:'10',fullPaymentQuantity:'4',depositQuantity:'0',directQuantity:'6',lineIds:['11','12']}
 const p=parent([line('11','2',{hzkj_qty:'6',procurementSource}),line('12','2',{hzkj_qty:'4',procurementSource})])
 const g=purchase();g.display.rows[0].lines=purchased as any
 const r=project(p,[g])
 expect(r.timestampProcurementBasis.lineCoverageVerified).toBe(covered)
 expect(r.procurementProgress.purchaseOrder).toBe(covered?'ordered':'partial')
})
it('cannot establish complete purchase coverage from an incomplete stock source even when all original demand is purchased',()=>{
 const procurementSource={skuId:'sku-1',complete:false,demandQuantity:'10',directQuantity:null,lineIds:['11','12']}
 const p=parent([line('11','2',{hzkj_qty:'6',procurementSource}),line('12','2',{hzkj_qty:'4',procurementSource})])
 const g=purchase();g.display.rows[0].lines=[{fulfillmentLineId:'11',quantity:'6'},{fulfillmentLineId:'12',quantity:'4'}]
 expect(project(p,[g]).timestampProcurementBasis.lineCoverageVerified).toBe(false)
})
it('trusts paid header for a linked order without inventing missing SKU relationships',()=>{
 const g=purchase({hasAlibabaOffer:false,hzkj_1688_order_n:''});g.display.rows[0].lines=[]
 const r=project(parent([line('11','2')]),[g])
 expect(r.procurementProgress.supplierPayment).toBe('paid')
 expect(r.procurementLineEvidence.paidLineIds).toEqual([])
})
it('preserves partial refund separately from full refund',()=>{
 expect(project(parent([line('11','2')]),[purchase({hzkj_pay_status:'4'})]).procurementProgress.supplierPayment).toBe('partially_refunded')
 expect(project(parent([line('11','2')]),[purchase({hzkj_pay_status:'3'})]).procurementProgress.supplierPayment).toBe('refunded')
})
