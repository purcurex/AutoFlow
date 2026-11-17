import { orderDispatchTaskStatus, hasDispatchSyncFailure } from './order-dispatch-status'
import Decimal from 'decimal.js'
type Row=Record<string,any>
export type PurchaseState='unpurchased'|'purchasing'|'partial_purchased'|'purchased'|'partial_shipped'|'shipped'|'partial_received'|'received'|'not_required'|'unknown'
/** Partial completion is determined by the most advanced line, not the least advanced line. */
export function aggregatePurchase(states:readonly string[]):PurchaseState {
 const active=states.filter(s=>s!=='not_required')
 if(!active.length)return 'not_required'
 if(active.some(s=>!['unpurchased','purchasing','purchased','shipped','partial_received','received'].includes(s)))return 'unknown'
 for(const [whole,partial] of [['received','partial_received'],['shipped','partial_shipped'],['purchased','partial_purchased']] as const){
  if(active.includes(whole)||active.includes(partial))return active.every(s=>s===whole)?whole:partial
 }
 return active.includes('purchasing')?'purchasing':'unpurchased'
}
const qty=(v:unknown):Decimal|null=>{try{return ['string','number'].includes(typeof v)&&/^\d+(\.\d+)?$/.test(String(v))?new Decimal(String(v)):null}catch{return null}}
export const nativeOrderStates:Record<string,string>={'0':'cancelled',no:'sku_unlinked','1':'unpaid','2':'paid','3':'processing','4':'fulfilled','5':'partial_fulfilled','6':'fulfillment_cancelled'}
/** Same-document source facts only. Future explicit fields are optional until FOP supplies them. */
export function orderBusinessStatus(raw:Row) {
 const entries:Row[]=Array.isArray(raw.hzkj_orders_billentry)?raw.hzkj_orders_billentry:[]
 const parents=new Set(entries.map(l=>String(l.pid??'')).filter(x=>x&&x!=='0'))
 const lines=entries.map(l=>{
  const sku=l.hzkj_local_sku??{},virtual=sku.number==='HZ000020-001'||sku.hzkj_good?.hzkj_good_carrier==='2'
  const excluded=virtual||parents.has(String(l.id))||l.requiresPhysicalOutbound===false
  // Existing use_stock=1 is the full-payment stock selection in ReservedStockOrderUtil.
  let purchase:PurchaseState=excluded?'not_required':l.hzkj_use_stock==='1'?'purchased':
   l.hzkj_entrypurc_status==='3'?'received':l.hzkj_entrypurc_status==='4'?'shipped':
   l.supplierPaymentStatus==='paid'?'purchased':l.purchaseApplicationCreated===true||l.hzkj_entrypurc_status==='2'?'purchasing':
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
 const source=raw.hzkj_fulfillment_status
 const sourceShipment=raw.hzkj_shop?.hzkj_shop_class?.number==='Offline'||source==='manual'?'manual':
  ['fulfilled','partial','unfulfilled','restocked','pending','open','cancelled','scheduled','on demand'].includes(source)?source:'unknown'
 return {version:1,order:nativeOrderStates[raw.hzkj_orderstatus]??'unknown',sourceShipment,purchase:entries.length?aggregatePurchase(lines.map(l=>l.purchase)):'unknown',outbound,lines,
  missingFields:[...(physical.some(l=>l.outbound==='unknown')?['lineOutboundStatus']:[]),...(lines.some(l=>l.purchase==='purchasing')?['supplierPaymentStatus']:[])],outboundBasis:physical.some(l=>l.outbound==='unknown')&&outbound!=='unknown'?'native_all_or_none_header':'physical_lines',basis:'same_fulfillment_document'}
}
export function withOrderBusinessStatus(display:Row,raw:Row|undefined):Row {
 if(!raw||raw.id!==display.id)return display
 const supplement=display.salesSourceStatus
 const sourceRaw=!Object.prototype.hasOwnProperty.call(raw,'hzkj_fulfillment_status')&&supplement?.source==='fulfillment_capture'&&supplement.sourceId===raw.id&&supplement.orderStatus===raw.hzkj_orderstatus?{...raw,hzkj_fulfillment_status:supplement.fulfillmentStatus}:raw
 const businessStatus=orderBusinessStatus(sourceRaw)
 const dispatchFailure=hasDispatchSyncFailure({...display,businessStatus})
 return {...display,businessStatus,...(dispatchFailure?{exception:{type:'dispatch_exception',reason:'Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。',hours:null}}:{}),dispatchTaskStatus:orderDispatchTaskStatus({...display,businessStatus}),items:(display.items??[]).map((item:Row)=>({...item,purchaseState:businessStatus.lines.find(l=>l.id===item.id)?.purchase??'unknown'}))}
}
