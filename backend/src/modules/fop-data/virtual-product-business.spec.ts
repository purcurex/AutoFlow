import { orderBusinessStatus } from './order-business-status'
import { scopedPurchaseGroup } from './collected-native-facts'
import { timestampProcurementProjection } from '../workbench-replica/timestamp-procurement-projection'
import { isStageCompleted } from './completed-orders'
import { matchesQueue } from './workbench-queue-rules'

const physical = { id:'1',hzkj_qty:'2',hzkj_entrypurc_status:'0',hzkj_outbound_status:'0',hzkj_local_sku:{number:'P'} }
const shapes = [
 {hzkj_local_sku:{number:'HZ000020-001'}}, {hzkj_local_sku_number:'HZ000020-001'},
 {'hzkj_local_sku.number':'HZ000020-001'}, {hzkj_local_sku:{number:'V',hzkj_good:{hzkj_good_carrier:'2'}}},
 {hzkj_local_sku_hzkj_good_hzkj_good_carrier:'2'}, {isVirtual:true},
]
describe('virtual product states cannot classify physical business',()=>{
 it.each(shapes)('excludes every supported identity shape %j',shape=>{
  for(const state of ['0','1','2','3','4',null,'invalid']){
   const result=orderBusinessStatus({hzkj_purchase_status:'0',hzkj_delivery_status:'0',hzkj_orders_billentry:[physical,{id:'2',pid:'1',hzkj_qty:'999',hzkj_entrypurc_status:state,hzkj_instock_qty:'999',hzkj_outbound_status:state,hzkj_outbound_qty:'999',...shape}]})
   expect(result).toMatchObject({purchase:'unpurchased',outbound:'pending',lines:[{excluded:false,purchase:'unpurchased',outbound:'pending'},{excluded:true,purchase:'not_required',outbound:'not_required'}]})
  }
 })
 it('does not use virtual shipment states to make a purchase group partial',()=>{
  const group={purchase:{payment:'paid',placement:'placed'},rawCancelStatus:'A',rows:[{orderId:'10',lines:[{sku:'P',rawPurchaseEntryStatus:'0',quantity:2,shippedQuantity:null},{sku:'HZ000020-001',rawPurchaseEntryStatus:'4',quantity:100,shippedQuantity:null}]}]}
  expect(scopedPurchaseGroup(group,null)).toMatchObject({shipment:'pending',stage:'supplier_pending'})
  expect(scopedPurchaseGroup({...group,rows:[{orderId:'10',lines:[{sku:'V',isVirtual:true,rawPurchaseEntryStatus:'4',quantity:null,shippedQuantity:null}]}]},null).stage).toBe('not_required')
 })
 it('ignores a virtual-only unpaid purchase when classifying real demand',()=>{
  const parent={id:'10',billstatus:'C',hzkj_orderstatus:'2',hzkj_orders_billentry:[physical,{id:'2',hzkj_local_sku:{number:'HZ000020-001'}}]}
  const group={raw:{hzkj_cancelstatus:'A',hzkj_purchase_channel:'1',hzkj_1688_order_n:'123',hzkj_pay_status:'0'},display:{association:{state:'verified'},rows:[{orderId:'10',associationState:'verified',lines:[{fulfillmentLineId:'2',quantity:1}]}]}}
  expect(timestampProcurementProjection(parent,[group],[],[])).toMatchObject({procurementStage:'purchase_order_pending',procurementQueueFlags:{pending:true,shipping:false,completed:false}})
 })
 it.each([['0','unpurchased'],['2','purchased'],['4','shipped']])('excludes virtual-only orders from procurement work while preserving native header %s', (status,purchase)=>{
  const parent={id:'10',billstatus:'C',hzkj_orderstatus:'2',hzkj_purchase_status:status,hzkj_orders_billentry:[{id:'2',hzkj_qty:'1',hzkj_entrypurc_status:'2',hzkj_local_sku:{number:'HZ000020-001'}}]}
  expect(timestampProcurementProjection(parent,[],[],[])).toMatchObject({businessStatus:{purchase},procurementStage:'not_required',procurementQueueFlags:{pending:false,shipping:false,completed:false}})
 })
 it('allocation completion requires both ready and audited, independent of item or outbound state',()=>{
  const order:any={reviewStatus:'approved',paymentStatus:'paid',fulfillmentProgress:{allocationCreated:true,allocationReview:'approved',stockReadiness:'incomplete',outbound:'completed'}}
  expect(isStageCompleted(order,'allocation_review')).toBe(false)
  order.fulfillmentProgress.stockReadiness='ready';order.fulfillmentProgress.outbound='unknown'
  expect(isStageCompleted(order,'allocation_review')).toBe(true)
  order.fulfillmentProgress.allocationReview='pending'
  expect(matchesQueue(order,'allocation_review')).toBe(true)
 })
})
