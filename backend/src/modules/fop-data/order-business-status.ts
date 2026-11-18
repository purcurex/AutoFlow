import { collectedPackageSource } from './collected-actual-channel'
import { withPaymentDataQuality } from './payment-data-quality'
import { orderDispatchTaskStatus, hasDispatchSyncFailure, hasMissingObtainedTracking, missingObtainedTrackingReason, hasMissingFulfilledTracking, missingFulfilledTrackingReason, dispatchSyncFailureReason } from './order-dispatch-status'
import Decimal from 'decimal.js'
import { physicalBusinessLines } from './physical-business-lines'
type Row=Record<string,any>
export type PurchaseState='unpurchased'|'purchasing'|'partial_purchased'|'purchased'|'partial_shipped'|'shipped'|'partial_received'|'received'|'not_required'|'unknown'
/** Partial completion is determined by the most advanced line, not the least advanced line. */
export function aggregatePurchase(states:readonly string[]):PurchaseState {
 const active=states.filter(s=>s!=='not_required')
 if(!active.length)return 'not_required'
 for(const [whole,partial] of [['received','partial_received'],['shipped','partial_shipped'],['purchased','partial_purchased']] as const){
  if(active.includes(whole)||active.includes(partial))return active.every(s=>s===whole)?whole:partial
 }
 if(active.some(s=>!['unpurchased','purchasing'].includes(s)))return 'unknown'
 return active.includes('purchasing')?'purchasing':'unpurchased'
}
const qty=(v:unknown):Decimal|null=>{try{return ['string','number'].includes(typeof v)&&/^\d+(\.\d+)?$/.test(String(v))?new Decimal(String(v)):null}catch{return null}}
export const nativeOrderStates:Record<string,string>={'0':'cancelled',no:'sku_unlinked','1':'unpaid','2':'paid','3':'processing','4':'fulfilled','5':'partial_fulfilled','6':'fulfillment_cancelled'}
/** Same-document source facts only. Future explicit fields are optional until FOP supplies them. */
export function orderBusinessStatus(raw:Row) {
 const entries:Row[]=Array.isArray(raw.hzkj_orders_billentry)?raw.hzkj_orders_billentry:[]
 const physicalEntries=new Set(physicalBusinessLines(entries))
 const lines=entries.map(l=>{
  const excluded=!physicalEntries.has(l)
  // Existing use_stock=1 is the full-payment stock selection in ReservedStockOrderUtil.
  let purchase:PurchaseState=excluded?'not_required':l.hzkj_use_stock==='1'?'purchased':
   l.hzkj_entrypurc_status==='3'?'received':l.hzkj_entrypurc_status==='4'?'shipped':
   l.supplierPaymentStatus==='paid'?'purchased':l.purchaseApplicationCreated===true||['1','2'].includes(l.hzkj_entrypurc_status)?'purchasing':
   l.hzkj_entrypurc_status==='0'?'unpurchased':'unknown'
  const required=qty(l.hzkj_qty),received=qty(l.hzkj_instock_qty)
  if(!excluded&&l.hzkj_use_stock!=='1'&&required?.gt(0)&&received!==null&&received.gt(0))purchase=received.gte(required)?'received':'partial_received'
  const outboundQty=qty(l.hzkj_outbound_qty)
  const outbound=excluded?'not_required':required?.gt(0)&&outboundQty!==null?
   outboundQty.gte(required)?'completed':outboundQty.gt(0)?'partial':'pending':
   l.hzkj_outbound_status==='1'?'completed':l.hzkj_outbound_status==='0'?'pending':'unknown'
  return {id:String(l.id??''),purchase,outbound,excluded,rawPurchaseStatus:l.hzkj_entrypurc_status??null}
 })
 const physical=lines.filter(l=>!l.excluded)
 let outbound=!entries.length?'unknown':!physical.length?'not_required':physical.some(l=>l.outbound==='unknown')?'unknown':
  physical.every(l=>l.outbound==='completed')?'completed':physical.some(l=>['completed','partial'].includes(l.outbound))?'partial':'pending'
 // A native all/none header is retained as source evidence. The known-bug partial header is never used to reconstruct missing line facts.
 if(outbound==='unknown'&&physical.length&&['0','2'].includes(raw.hzkj_delivery_status))outbound=raw.hzkj_delivery_status==='2'?'completed':'pending'
 // Display the order's source shipment fact; shop type never supplies a status.
 const source=raw.hzkj_fulfillment_status
 const sourceShipment=typeof source==='string'&&source.trim()?source.trim():'unknown'
 return {version:1,order:nativeOrderStates[raw.hzkj_orderstatus]??'unknown',sourceShipment,purchase:entries.length?aggregatePurchase(lines.map(l=>l.purchase)):'unknown',outbound,lines,
  missingFields:[...(physical.some(l=>l.outbound==='unknown')?['lineOutboundStatus']:[]),...(lines.some(l=>l.purchase==='purchasing')?['supplierPaymentStatus']:[])],outboundBasis:physical.some(l=>l.outbound==='unknown')&&outbound!=='unknown'?'native_all_or_none_header':'physical_lines',basis:'same_fulfillment_document'}
}
export function withOrderBusinessStatus(display:Row,raw:Row|undefined,companyId?:string,options:{persistedExceptions?:boolean}={}):Row {
 if(!raw||raw.id!==display.id)return display
 const supplement=display.salesSourceStatus
 const sourceRaw=!Object.prototype.hasOwnProperty.call(raw,'hzkj_fulfillment_status')&&supplement?.source==='fulfillment_capture'&&supplement.sourceId===raw.id&&supplement.orderStatus===raw.hzkj_orderstatus?{...raw,hzkj_fulfillment_status:supplement.fulfillmentStatus}:raw
 const payments=display.procurementLineEvidence
 const enriched=payments?.source==='verified_purchase_lines'&&payments.sourceOrderId===raw.id?{...sourceRaw,hzkj_orders_billentry:(sourceRaw.hzkj_orders_billentry??[]).map((l:Row)=>({...l,...(payments.applicationLineIds?.includes(String(l.id))?{purchaseApplicationCreated:true}:{}),...(payments.paidLineIds.includes(String(l.id))?{supplierPaymentStatus:'paid'}:{})}))}:sourceRaw
 const identities=new Map((display.items??[]).map((item:Row)=>[String(item.id),item]))
 const identityRaw={...enriched,hzkj_orders_billentry:(enriched.hzkj_orders_billentry??[]).map((l:Row)=>{
  const item=identities.get(String(l.id)) as Row|undefined
  return item?.isVirtual===true && item.sku===(l.hzkj_local_sku?.number??l.hzkj_local_sku_number)?{...l,isVirtual:true}:l
 })}
 const businessStatus=orderBusinessStatus(identityRaw)
 const items=(display.items??[]).map((item:Row)=>({...item,purchaseState:businessStatus.lines.find(l=>l.id===item.id)?.purchase??'unknown'}))
 const fulfillmentProgress={...display.fulfillmentProgress,outbound:businessStatus.outbound}
 const nativeFulfillmentProgress=display.nativeFulfillmentProgress?{...display.nativeFulfillmentProgress,outbound:businessStatus.outbound}:undefined
 display={...display,fulfillmentProgress,...(nativeFulfillmentProgress?{nativeFulfillmentProgress}:{})}
 if(options.persistedExceptions)return {...display,businessStatus,dispatchTaskStatus:orderDispatchTaskStatus({...display,businessStatus}),items}
 const dispatchFailure=hasDispatchSyncFailure({...display,businessStatus})
 const packageRaw=collectedPackageSource(display,raw,companyId)
 const logisticsInfo=(Array.isArray(packageRaw?.hzkj_logistics_info)?packageRaw.hzkj_logistics_info:[]).filter((p:any)=>p&&typeof p==='object').map((p:Row)=>({packageTrackingNumber:p.hzkj_tracking_number}))
 const missingTracking=hasMissingFulfilledTracking({...display,businessStatus,logisticsInfo})
 const reasons=[dispatchFailure?(['fulfilled','partial_fulfilled'].includes(businessStatus.order)?'发运审核同步状态与履约状态不一致':dispatchSyncFailureReason):null,
  hasMissingObtainedTracking({...display,businessStatus})?missingObtainedTrackingReason:null,
  missingTracking?(packageRaw?.hzkj_logistics_info===undefined?'履约订单物流信息待核验':missingFulfilledTrackingReason):null].filter(Boolean)
 const reason=reasons.length?reasons.join('；'):null
 const previous=display.exception
 const derived=previous?.type==='dispatch_exception'&&(['dispatch_sync_failed','dispatch_tracking_missing','fulfillment_tracking_missing'].includes(previous.code)
  ||[dispatchSyncFailureReason,missingObtainedTrackingReason,missingFulfilledTrackingReason,'Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已履约订单缺少物流跟踪号'].includes(previous.reason))
 const exception=reason?{type:'dispatch_exception',reason,code:dispatchFailure?'dispatch_sync_failed':hasMissingObtainedTracking({...display,businessStatus})?'dispatch_tracking_missing':'fulfillment_tracking_missing',hours:null}:derived?null:previous
 const result=withPaymentDataQuality({...display,businessStatus,exception,dispatchTaskStatus:orderDispatchTaskStatus({...display,businessStatus}),items:(display.items??[]).map((item:Row)=>({...item,purchaseState:businessStatus.lines.find(l=>l.id===item.id)?.purchase??'unknown'}))},raw)
 return businessStatus.order==='fulfillment_cancelled'?{...result,exception:{type:'logistics_exception',reason:'取消履约',code:'fulfillment_cancelled',hours:null}}:result.exception?.code==='fulfillment_cancelled'?{...result,exception:null}:result
}
