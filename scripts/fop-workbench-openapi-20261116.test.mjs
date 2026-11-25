import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildRequest,parseArgs,runQuery} from './fop-workbench-openapi.mjs'
const window={startModifytime:'2026-11-15 00:00:00',endModifytime:'2026-11-16 00:00:00'}
test('classifies the observed gateway subscription rejection without returning private response contents',async()=>{
 const result=await runQuery({FOP_OPENAPI_ACCESS_TOKEN:'fixture',FOP_OPENAPI_IDENTITY:'fixture'},
 {operation:'customer-registrations',orgNumber:'hyperzone.test',orgId:'100000',orgName:'公司'},
 async()=>new Response(JSON.stringify({errorCode:'2505',messagecn:'private gateway text'}),{status:519}))
 assert.equal(result.report.errorCategory,'api-not-subscribed');assert.equal(result.raw,null)
 assert.ok(!JSON.stringify(result.report).includes('private gateway text'))
})
test('uses documented modification bounds for four changed list contracts',()=>{
 for(const op of ['allocation','dispatch','delivery-notice']){
  assert.deepEqual(buildRequest(op,{orgNumber:'hyperzone.test',...window}).body.data,{org_number:'hyperzone.test',start_modifytime:window.startModifytime,end_modifytime:window.endModifytime})
  assert.throws(()=>buildRequest(op,{orgNumber:'hyperzone.test'}),/modification_window_required/)
 }
 assert.throws(()=>buildRequest('stock',{orgNumber:'hyperzone.test',...window}),/invalid-request/)
 for(const bad of [{...window,startModifytime:'2026-02-30 00:00:00'},{...window,endModifytime:window.startModifytime},{...window,startModifytime:'2026-11-15T00:00:00Z'}])assert.throws(()=>buildRequest('allocation',{orgNumber:'hyperzone.test',...bad}),/invalid-request/)
})
test('builds customer creation-time and related read-only query parameters without guessing company fields',()=>{
 assert.deepEqual(buildRequest('customer-registrations',{orgNumber:'hyperzone.test',orgId:'100000',orgName:'公司'}).body.data,{org_number:'hyperzone.test',org_id:'100000',org_name:'公司'})
 assert.throws(()=>buildRequest('customer-registrations',{from:window.startModifytime,toExclusive:window.endModifytime,orgNumber:'hyperzone.test'}),/invalid-request/)
 assert.equal(buildRequest('purchase-refund-application',{orgNumber:'hyperzone.test'}).path,'/kapi/v2/hzkj/hzkj_einkauf/hzkj_purrefundapplybill/queryPurchaseRefundApplication')
 assert.throws(()=>buildRequest('purchase-refund-application',{orgNumber:'hyperzone.test',id:'123'}),/invalid-request/)
 assert.deepEqual(buildRequest('freight-exception',{orderNumber:'SO-1'}).body.data,{hzkj_sale_order_no:'SO-1'})
 assert.throws(()=>buildRequest('freight-exception',{orderNumber:'*'}),/invalid-request/)
})
test('accepts only documented per-entity related-document filters',()=>{
 assert.equal(buildRequest('purchase',{orgNumber:'hyperzone.test',sourceStockBillno:'BH-1'}).body.data.source_stock_billno,'BH-1')
 assert.equal(buildRequest('receipt-notice',{orgNumber:'hyperzone.test',purchaseOrderNumber:'PO-1'}).body.data.hzkj_purchase_order_numbe,'PO-1')
 assert.equal(buildRequest('payment',{orgNumber:'hyperzone.test',purchaseOrderNumber:'PO-1'}).body.data.hzkj_purorder_no,'PO-1')
 assert.equal(buildRequest('inbound',{orgNumber:'hyperzone.test',sourceBillNumber:'RC-1'}).body.data.srcbillnumber,'RC-1')
 assert.throws(()=>buildRequest('stock',{orgNumber:'hyperzone.test',sourceStockBillno:'BH-1'}),/invalid-request/)
 assert.equal(parseArgs(['--operation','allocation','--org-number','hyperzone.test','--start-modifytime',window.startModifytime,'--end-modifytime',window.endModifytime]).startModifytime,window.startModifytime)
})

test('material return supports an optional exact bill number and uses the supplied im_purinbill API', () => {
 const request=buildRequest('purchase-material-return',{billno:'CGRK-261021-000052',pageNo:1,pageSize:100})
 assert.equal(request.path,'/kapi/v2/hzkj/im/im_purinbill/queryPurchaseMaterialReturn')
 assert.deepEqual(request.body.data,{billno:'CGRK-261021-000052'})
 assert.deepEqual(buildRequest('purchase-material-return',{}).body.data,{})
 assert.throws(()=>buildRequest('purchase-material-return',{billno:'*'}))
})
test('retired material-return API is blocked before token and network',async()=>{
 let calls=0;await assert.rejects(runQuery({FOP_OPENAPI_ACCESS_TOKEN:'fixture',FOP_OPENAPI_IDENTITY:'fixture'},{operation:'purchase-material-return',billno:'R1'},async()=>{calls++;throw Error('network')}),/fop_retired_endpoint/);assert.equal(calls,0)
})
