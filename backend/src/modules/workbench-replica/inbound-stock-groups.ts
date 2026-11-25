import { orderDocumentType } from '../fop-data/order-document-type'
import Decimal from 'decimal.js'
import type { DataSource } from 'typeorm'
type Row=Record<string,any>
const D=Decimal.clone({precision:40})
function quantity(v:unknown){try{if(v==null||v==='')return null;const n=new D(String(v));return n.isFinite()&&n.gte(0)?n:null}catch{return null}}
const sum=(rows:Row[],key:string)=>{let n=new D(0);for(const r of rows){const v=quantity(r[key]);if(!v)return null;n=n.plus(v)}return n.toNumber()}
/** Aggregate at the stock document boundary. Never allocate an order to an individual package. */
export function stockGroup(stock:Row,consumptions:Row[],purchases:Row[],packages:Row[],complete:boolean){
 const items=new Map<string,Row>(),seen=new Set<string>();let invalid=!complete
 for(const l of stock.display.items??[]){const sku=String(l.sku??'').trim(),n=quantity(l.quantity);if(!sku||!n){invalid=true;continue}const item=items.get(sku)??{sku,name:l.name??null,quantity:new D(0),reserved:new D(0),used:new D(0)};item.quantity=item.quantity.plus(n);items.set(sku,item)}
 const orders=new Map<string,Row>()
 for(const c of consumptions){if(seen.has(c.record_id))continue;seen.add(c.record_id)
  if(c.payload?.stockNumber!==stock.display.stockNumber){invalid=true;continue}
  const n=quantity(c.quantity),sku=c.payload?.skuNumber,item=items.get(sku)
  if(!['0','1'].includes(c.use_status)||!n||!item){invalid=true;continue}
  item[c.use_status==='0'?'reserved':'used']=item[c.use_status==='0'?'reserved':'used'].plus(n)
  if(c.visible&&c.order_id){const o=orders.get(c.order_id)??{id:c.order_id,number:c.order_number,...orderDocumentType(c.order_raw??{}),customerName:c.customer_name,reserved:new D(0),used:new D(0),skus:new Set<string>()};o[c.use_status==='0'?'reserved':'used']=o[c.use_status==='0'?'reserved':'used'].plus(n);o.skus.add(sku);orders.set(c.order_id,o)}
 }
 const products=[...items.values()].map(l=>{const linked=l.reserved.plus(l.used),remaining=l.quantity.minus(linked);return {sku:l.sku,name:l.name,quantity:l.quantity.toNumber(),reservedQuantity:invalid?null:l.reserved.toNumber(),usedQuantity:invalid?null:l.used.toNumber(),unassignedQuantity:invalid||remaining.lt(0)?null:remaining.toNumber()}})
 const purchaseMap=new Map<string,Row>(),lineKeys=new Set<string>()
 for(const p of purchases){const lineKey=p.id+':'+p.line_id;if(lineKeys.has(lineKey))continue;lineKeys.add(lineKey);const group=purchaseMap.get(p.id)??{id:p.id,number:p.number,status:p.status,paymentStatus:p.payment_status,lines:[]};group.lines.push(p);purchaseMap.set(p.id,group)}
 const purchaseRows=[...purchaseMap.values()].map(({lines,...p})=>({...p,quantity:sum(lines,'quantity')}))
 return {id:stock.source_id,number:stock.display.stockNumber,type:stock.display.stockType,products,purchases:purchaseRows,packages,
 orders:[...orders.values()].map(o=>({id:o.id,number:o.number,orderTypeCode:o.orderTypeCode,orderTypeName:o.orderTypeName,customerName:o.customerName,reservedQuantity:o.reserved.toNumber(),usedQuantity:o.used.toNumber(),skus:[...o.skus]})),
 totals:{stockQuantity:products.length?sum(products,'quantity'):null,purchaseQuantity:sum(purchaseRows,'quantity'),reservedQuantity:sum(products,'reservedQuantity'),usedQuantity:sum(products,'usedQuantity'),unassignedQuantity:products.length?sum(products,'unassignedQuantity'):null},
 unassignedComplete:products.length>0&&!invalid&&products.every(p=>p.unassignedQuantity!==null)}
}
export async function readInboundStockGroups(db:Pick<DataSource,'query'>,batch:Row,ids:string[],employees:readonly string[]|null){
 if(!ids.length)return new Map<string,Row>()
 const scope=[batch.id,ids,employees]
 const stocks:Row[]=await db.query(`SELECT source_id,display FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' AND source_id=ANY($2::text[]) AND ($3::text[] IS NULL OR owner_employee_id=ANY($3))`,scope)
 if(!stocks.length)return new Map<string,Row>()
 const allowed=stocks.map(s=>s.source_id),numbers=stocks.map(s=>s.display.stockNumber)
 const [cons,purchases,notices]:Row[][]=await Promise.all([
 db.query(`SELECT c.*,o.source_id order_id,o.raw order_raw,o.display->>'customerName' customer_name,($3::text[] IS NULL OR o.owner_employee_id=ANY($3)) visible FROM hz_fop_collected_stock_consumptions c LEFT JOIN hz_fop_collected_orders o ON o.batch_id=c.batch_id AND o.order_number=c.order_number WHERE c.batch_id=$1 AND c.stock_id=ANY($2::text[])`,[batch.id,allowed,employees]),
 db.query(`SELECT f.source_id id,f.document_number number,f.raw->>'billstatus_title' status,f.raw->>'hzkj_pay_status_title' payment_status,l->>'id' line_id,l->>'hzkj_qty' quantity,coalesce(nullif(l->>'hzkj_srcbillid','0'),nullif(l->>'hzkj_salbillid','0')) stock_id,coalesce(nullif(l->>'hzkj_srcbillnumber',''),l->>'hzkj_salbillnumber') stock_number FROM hz_fop_collected_analytics_facts f CROSS JOIN LATERAL jsonb_array_elements(f.raw->'hzkj_billentry') l WHERE f.batch_id=$1 AND f.entity_type='purchase' AND f.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B' AND (coalesce(nullif(l->>'hzkj_srcbillid','0'),nullif(l->>'hzkj_salbillid','0'))=ANY($2::text[]) OR coalesce(nullif(l->>'hzkj_srcbillnumber',''),l->>'hzkj_salbillnumber')=ANY($3::text[]))`,[batch.id,allowed,numbers]),
 db.query(`SELECT e.source_id id,e.display->>'number' number,e.raw->>'hzkj_waybill_number' tracking_number,e.raw->>'hzkj_logistics_company' carrier,e.raw->>'hzkj_shipping_time' shipped_at,e.display->>'rawWmsStatus' status,l->>'sourceDocumentId' stock_id,array_agg(DISTINCT l->>'purchaseId') FILTER(WHERE l->>'purchaseId' IS NOT NULL) purchase_ids FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND e.display->>'rawCancelStatus'='A' AND coalesce(e.display->>'rawWmsStatus','') NOT IN ('15','20','25') AND l->>'sourceDocumentKind'='stock' AND l->>'sourceDocumentId'=ANY($2::text[]) GROUP BY e.source_id,e.display,e.raw,l->>'sourceDocumentId'`,[batch.id,allowed])])
 const capture=batch.metadata?.entityCaptures?.stock_consumptions,complete=capture?.complete===true&&capture.companyId===batch.company_id
 return new Map(stocks.map(s=>{
 const grouped=new Map<string,Row>()
 for(const n of notices.filter(n=>n.stock_id===s.source_id)){const key=n.tracking_number?JSON.stringify([n.carrier,n.tracking_number]):'notice:'+n.id;const g=grouped.get(key)??{id:key,trackingNumber:n.tracking_number,carrier:n.carrier,shippedAt:n.shipped_at,noticeNumbers:[],purchaseIds:[],statuses:[]};g.noticeNumbers.push(n.number);g.purchaseIds=[...new Set([...g.purchaseIds,...(n.purchase_ids??[])])];g.statuses.push(n.status);grouped.set(key,g)}
 const group=stockGroup(s,cons.filter(c=>c.stock_id===s.source_id),purchases.filter(p=>p.stock_id?p.stock_id===s.source_id&&(!p.stock_number||p.stock_number===s.display.stockNumber):p.stock_number===s.display.stockNumber),[...grouped.values()],complete)
 return [s.source_id,group]
 }))
}
