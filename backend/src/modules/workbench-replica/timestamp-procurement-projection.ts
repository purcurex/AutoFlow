import { purchasePayment } from '../fop-data/purchase-payment'
import { physicalPurchaseGroups } from '../fop-data/physical-business-lines'
import { usesReservedStock, pendingPurchaseStage } from '../fop-data/procurement-demand'
import { orderBusinessStatus } from '../fop-data/order-business-status'
import { purchaseFulfillmentLine } from '../fop-data/collected-purchase-association'
import Decimal from 'decimal.js'
type Row=Record<string,any>
const number=(v:unknown):Decimal|null=>{try{if(v===null||v===undefined||v==='')return null;const d=new Decimal(String(v));return d.isFinite()&&d.gte(0)?d:null}catch{return null}}
/** Fulfillment writeback establishes the milestone; purchase documents supply their own action details. */
export function timestampProcurementProjection(parent:Row,groups:{raw:Row;display:Row}[],applications:Row[]=[],dispatches:Row[]|null|undefined=undefined){
 groups=physicalPurchaseGroups(parent,groups)
 const linked=groups.filter(g=>g.raw.hzkj_cancelstatus!=='B'&&purchasePayment(g.raw)!=='cancelled')
 const states=linked.map(g=>{const r=g.raw,payment=purchasePayment(r),offline=r.hzkj_purchase_channel==='2',online=r.hzkj_purchase_channel==='1',placement=['paid','refunded','partially_refunded'].includes(payment)||offline?'placed':online&&r.hasAlibabaOffer===true?(typeof r.hzkj_1688_order_n==='string'&&r.hzkj_1688_order_n.trim()?'placed':'pending'):'unknown',shipment=['1','2'].includes(r.hzkj_ship_status)||['C','D','E','F','G'].includes(r.hzkj_logisticsstatus)?'shipped':r.hzkj_ship_status==='0'||r.hzkj_logisticsstatus==='A'?'pending':r.hzkj_logisticsstatus==='B'?'partial':'unknown';return {payment,placement,shipment,offline}})
 const purchased=new Map<string,Decimal>(),invalid=new Set<string>()
 for(const g of linked)for(const r of g.display.rows??[])if(r.orderId===parent.id)for(const l of r.lines??[]){if(!l.fulfillmentLineId)continue;const q=number(l.quantity);if(!q)invalid.add(l.fulfillmentLineId);else purchased.set(l.fulfillmentLineId,(purchased.get(l.fulfillmentLineId)??new Decimal(0)).plus(q))}
 const excluded=new Set(orderBusinessStatus(parent).lines.filter(l=>l.excluded).map(l=>l.id))
 const lines=(parent.hzkj_orders_billentry??[]).filter((l:Row)=>!excluded.has(String(l.id))&&!usesReservedStock(l)),coverage=Array.isArray(lines)&&lines.length>0&&lines.every((l:Row)=>{const q=number(l.hzkj_qty);return q!==null&&!invalid.has(l.id)&&(purchased.get(l.id)??new Decimal(0)).gte(q)})
 const valid=linked.length>0&&linked.every(g=>g.raw.hzkj_cancelstatus==='A'&&g.display.association?.state!=='conflict'&&(g.display.rows??[]).filter((r:Row)=>r.orderId===parent.id).every((r:Row)=>r.associationState==='verified'))
 let stage:string,payment='unknown',placement='unknown'
 if(valid){
  if(states.some(s=>['refunded','partially_refunded'].includes(s.payment))){payment=states.every(s=>s.payment==='refunded')?'refunded':'partially_refunded'}
  else if(states.some(s=>s.placement==='pending')){placement='not_pushed'}
  else if(states.some(s=>s.payment==='unpaid')){payment='unpaid'}
  else if(states.every(s=>s.payment==='paid'&&s.placement==='placed')){
   payment='paid';placement=states.every(s=>s.offline)?'not_required':'pushed'
  }
 }
 const paidLineIds=new Set<string>()
 for(const g of linked){
  if(g.raw.hzkj_cancelstatus!=='A'||g.raw.hzkj_pay_status!=='1'||g.display.association?.state==='conflict')continue
  for(const r of g.display.rows??[])if(r.orderId===parent.id&&r.associationState==='verified')
   for(const l of r.lines??[])if(l.fulfillmentLineId&&number(l.quantity)?.gt(0))paidLineIds.add(String(l.fulfillmentLineId))
 }
 const applicationLineIds=new Set<string>()
 for(const a of applications){if(a.hzkj_cancelstatus!=='A')continue
  for(const l of a.entryentity??[])if(l.hzkj_srcbillnumber===parent.billno){const entry=purchaseFulfillmentLine(l,parent);if(entry)applicationLineIds.add(String(entry.id))}
 }
 const businessStatus=orderBusinessStatus({...parent,hzkj_orders_billentry:(parent.hzkj_orders_billentry??[]).map((l:Row)=>({...l,...(applicationLineIds.has(String(l.id))?{purchaseApplicationCreated:true}:{}),...(paidLineIds.has(String(l.id))?{supplierPaymentStatus:'paid'}:{})}))})
 const physical=businessStatus.lines.filter(l=>!l.excluded)
 const stockIds=new Set((parent.hzkj_orders_billentry??[]).filter((l:Row)=>usesReservedStock(l)).map((l:Row)=>String(l.id)))
 const demand=physical.filter(l=>!stockIds.has(l.id))
 const cancelled=businessStatus.order==='cancelled'
 const pendingStage=pendingPurchaseStage(parent,demand,groups,dispatches)
 const flags={pending:pendingStage!==null,shipping:!cancelled&&demand.some(l=>l.purchase==='purchased'),completed:!cancelled&&demand.length>0&&demand.every(l=>['shipped','partial_received','received'].includes(l.purchase))}
 const noNeed=physical.length>0&&demand.length===0||businessStatus.purchase==='not_required'
 // Supplier tracking is not receipt-notice approval. Never let the old order header override lines.
 const shipment=demand.length&&demand.every(l=>['shipped','partial_received','received'].includes(l.purchase))?'shipped':demand.some(l=>['shipped','received','partial_received'].includes(l.purchase))?'partial':demand.some(l=>l.purchase==='purchased')?'pending':'unknown'
 if(cancelled)stage='cancelled'
 else if(noNeed)stage='not_required'
 else if(flags.completed)stage='shipped'
 else if(flags.pending)stage=pendingStage!
 else if(flags.shipping)stage=shipment==='partial'?'supplier_partial':'supplier_pending'
 else stage='unknown'
 const nativeKnown=physical.some(l=>l.purchase!=='unknown')
 if(stage==='purchase_order_pending'&&linked.some(g=>(g.display.rows??[]).some((r:Row)=>r.orderId===parent.id&&(r.lines??[]).some((l:Row)=>!l.fulfillmentLineId))))stage='unknown'
 const relationshipConflict=linked.some(g=>(g.display.rows??[]).some((r:Row)=>r.orderId===parent.id&&r.associationState!=='verified')||g.display.association?.state==='conflict')

 return {businessStatus,procurementQueueFlags:flags,procurementLineEvidence:{source:'verified_purchase_lines',sourceOrderId:parent.id,paidLineIds:[...paidLineIds].sort(),applicationLineIds:[...applicationLineIds].sort()},nativeProcurementCaptured:nativeKnown||noNeed||groups.length>0,procurementStage:stage,nativeSupplierShipment:shipment,procurementProgress:{purchaseOrder:valid?(coverage?'ordered':'partial'):'unknown',supplierPayment:payment,alibabaOrder:placement},nativeProcurementAssociationIssues:relationshipConflict?['current_purchase_relationship_conflict']:[],timestampProcurementBasis:{source:'fulfillment_lines_and_verified_purchase_payment',consistentSnapshot:false,lineCoverageVerified:coverage,missingFields:coverage?[]:['current_order_line_quantity_and_complete_purchase_line_coverage']}}
}
