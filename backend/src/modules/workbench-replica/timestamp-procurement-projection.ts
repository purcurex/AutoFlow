import { orderBusinessStatus } from '../fop-data/order-business-status'
import Decimal from 'decimal.js'
type Row=Record<string,any>
const number=(v:unknown):Decimal|null=>{try{if(v===null||v===undefined||v==='')return null;const d=new Decimal(String(v));return d.isFinite()&&d.gte(0)?d:null}catch{return null}}
/** Independent purchase documents may prove open actions and shipment coverage without borrowing old header fields. */
export function timestampProcurementProjection(parent:Row,groups:{raw:Row;display:Row}[]){
 const linked=groups.filter(g=>g.raw.hzkj_cancelstatus!=='B')
 const states=linked.map(g=>{const r=g.raw,payment=({0:'unpaid',1:'paid',3:'refunded'} as Row)[r.hzkj_pay_status]??'unknown',offline=r.hzkj_purchase_channel==='2',online=r.hzkj_purchase_channel==='1',placement=offline?'placed':online&&r.hasAlibabaOffer===true?(typeof r.hzkj_1688_order_n==='string'&&r.hzkj_1688_order_n.trim()?'placed':'pending'):'unknown',shipment=['1','2'].includes(r.hzkj_ship_status)||['C','D','E','F','G'].includes(r.hzkj_logisticsstatus)?'shipped':r.hzkj_ship_status==='0'||r.hzkj_logisticsstatus==='A'?'pending':r.hzkj_logisticsstatus==='B'?'partial':'unknown';return {payment,placement,shipment,offline}})
 const purchased=new Map<string,Decimal>(),invalid=new Set<string>()
 for(const g of linked)for(const r of g.display.rows??[])if(r.orderId===parent.id)for(const l of r.lines??[]){if(!l.fulfillmentLineId)continue;const q=number(l.quantity);if(!q)invalid.add(l.fulfillmentLineId);else purchased.set(l.fulfillmentLineId,(purchased.get(l.fulfillmentLineId)??new Decimal(0)).plus(q))}
 const excluded=new Set(orderBusinessStatus(parent).lines.filter(l=>l.excluded).map(l=>l.id))
 const lines=(parent.hzkj_orders_billentry??[]).filter((l:Row)=>!excluded.has(String(l.id))&&l.hzkj_use_stock!=='1'),coverage=Array.isArray(lines)&&lines.length>0&&lines.every((l:Row)=>{const q=number(l.hzkj_qty);return q!==null&&!invalid.has(l.id)&&(purchased.get(l.id)??new Decimal(0)).gte(q)})
 const valid=linked.length>0&&linked.every(g=>g.raw.hzkj_cancelstatus==='A'&&(g.display.rows??[]).filter((r:Row)=>r.orderId===parent.id).every((r:Row)=>r.associationState==='verified'))
 let stage='unknown',shipment='unknown',payment='unknown',placement='unknown'
 if(valid){
  if(states.some(s=>s.payment==='refunded')){stage='refund_pending';payment='refunded'}
  else if(states.some(s=>s.placement==='pending')){stage='alibaba_pending';placement='not_pushed'}
  else if(states.some(s=>s.payment==='unpaid')){stage='payment_pending';payment='unpaid'}
  else if(states.every(s=>s.payment==='paid'&&s.placement==='placed')){
   payment='paid';placement=states.every(s=>s.offline)?'not_required':'pushed'
   if(coverage&&states.every(s=>s.shipment!=='unknown')){shipment=states.every(s=>s.shipment==='shipped')?'shipped':states.some(s=>['shipped','partial'].includes(s.shipment))?'partial':'pending';stage=shipment==='shipped'?'shipped':shipment==='partial'?'supplier_partial':'supplier_pending'}
  }
 }
 return {nativeProcurementCaptured:groups.length>0,procurementStage:stage,nativeSupplierShipment:shipment,procurementProgress:{purchaseOrder:valid?(coverage?'ordered':'partial'):'unknown',supplierPayment:payment,alibabaOrder:placement},nativeProcurementAssociationIssues:[...(!valid?['current_purchase_relationship_unresolved']:[]),...(!coverage?['current_order_lines_purchase_coverage_unproven']:[])],timestampProcurementBasis:{source:'independent_local_purchase_documents',consistentSnapshot:false,lineCoverageVerified:coverage,missingFields:coverage?[]:['current_order_line_quantity_and_complete_purchase_line_coverage']}}
}
