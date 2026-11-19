import Decimal from 'decimal.js'
const Quantity=Decimal.clone({precision:40})
import { physicalBusinessLines } from './physical-business-lines'
type Row=Record<string,any>
const text=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.trim():null
const ref=(r:Row,key:string)=>text(r[key+'_id']??r[key]?.id??r[key+'.id'])
const qty=(v:unknown):Decimal|null=>{try{if(v==null||v==='')return null;const n=new Quantity(String(v));return n.isFinite()&&n.gte(0)&&n.lt('10000000000000000')&&n.decimalPlaces()<=8?n:null}catch{return null}}
export interface StockConsumption {
 stockId:string;stockNumber?:string|null;recordId:string;orderNumber:string;skuId:string|null;skuNumber:string|null
 stockType:'1'|'2'|null;status:'0'|'1'|null;quantity:string|null;usedAt:string|null;stockPurchaseStatus?:string|null
 customerId:string|null;warehouseId:string|null;issues:string[];raw:Row
}
export interface StockConsumptionSnapshot {records:StockConsumption[];complete:boolean;revision:string}
export interface SkuProcurementSource {
 skuId:string;sku:string|null;lineIds:string[];demandQuantity:string;fullPaymentQuantity:string|null;depositQuantity:string|null;directQuantity:string|null
 fullPaymentReserved:string|null;fullPaymentUsed:string|null;depositReserved:string|null;depositUsed:string|null
 complete:boolean;records:StockConsumption[]
}
export interface ProcurementSources {version:1;orderId:string;orderNumber:string;revision:string;status:'complete'|'incomplete'|'not_applicable';items:SkuProcurementSource[];issues:string[]}
/** Current stock-document children, never an append-only event total. IDs remain strings. */
export function normalizeStockConsumptions(stocks:Row[],companyId:string):StockConsumption[]{
 const records=new Map<string,StockConsumption>()
 for(const s of stocks){
  if(String(s.org_id??s.org?.id)!==companyId)throw Error('consumption_company_mismatch')
  const stockId=text(s.id);if(!stockId)throw Error('consumption_stock_id_missing')
  if(!Object.prototype.hasOwnProperty.call(s,'hzkj_sale_order_use'))throw Error('consumption_collection_missing')
  if(s.hzkj_sale_order_use!==null&&!Array.isArray(s.hzkj_sale_order_use))throw Error('consumption_collection_invalid')
  for(const r of s.hzkj_sale_order_use??[]){
   const recordId=text(r.id),orderNumber=text(r.hzkj_sale_order_billno)
   if(!recordId||!orderNumber)throw Error('consumption_identity_missing')
   const skuId=ref(r,'hzkj_sales_order_sku'),stockType=['1','2'].includes(s.hzkj_stock_type)?s.hzkj_stock_type:null,status=['0','1'].includes(r.hzkj_use_status)?r.hzkj_use_status:null,quantity=qty(r.hzkj_use_qty)
   const record:StockConsumption={stockId,stockNumber:text(s.billno),recordId,orderNumber,skuId,skuNumber:text(r.hzkj_sales_order_sku_number??r.hzkj_sales_order_sku?.number),stockType,status,quantity:quantity?.toFixed()??null,usedAt:text(r.hzkj_use_time),stockPurchaseStatus:text(s.hzkj_purchase_status),customerId:ref(s,'hzkj_customer'),warehouseId:ref(s,'hzkj_warehouse'),issues:[...(!skuId?['consumption_sku_missing']:[]),...(!stockType?['consumption_type_unknown']:[]),...(!status?['consumption_status_unknown']:[]),...(!quantity?['consumption_quantity_invalid']:[])],raw:r}
   const key=stockId+':'+recordId,prior=records.get(key)
   if(prior&&JSON.stringify(prior)!==JSON.stringify(record))throw Error('consumption_conflicting_record')
   records.set(key,record)
  }
 }
 return [...records.values()]
}
function demands(order:Row){
 const result=new Map<string,{sku:string|null;quantity:Decimal;lineIds:string[]}>(),issues:string[]=[]
 for(const l of physicalBusinessLines<Row>(order.hzkj_orders_billentry??[])){
  const skuId=ref(l,'hzkj_local_sku'),quantity=qty(l.hzkj_qty)
  if(!skuId||!quantity){issues.push('order_sku_demand_missing');continue}
  const current=result.get(skuId)??{sku:text(l.hzkj_local_sku_number??l.hzkj_local_sku?.number),quantity:new Quantity(0),lineIds:[]}
  current.quantity=current.quantity.plus(quantity);current.lineIds.push(String(l.id));result.set(skuId,current)
 }
 return {result,issues}
}
export function procurementSources(order:Row,snapshot:StockConsumptionSnapshot):ProcurementSources{
 const base={version:1 as const,orderId:String(order.id),orderNumber:String(order.billno),revision:snapshot.revision}
 if(order.billstatus!=='C')return {...base,status:'not_applicable',items:[],issues:[]}
 const {result:demand,issues}=demands(order),records=snapshot.records.filter(r=>r.orderNumber===order.billno)
 if(!snapshot.complete)issues.push('consumption_coverage_incomplete')
 for(const r of records){
  issues.push(...r.issues)
  if(r.skuId&&!demand.has(r.skuId))issues.push('consumption_sku_not_in_order')
  const customer=ref(order,'hzkj_customer'),warehouse=ref(order,'hzkj_dst_warehouse')
  if(customer&&r.customerId&&customer!==r.customerId)issues.push('consumption_customer_mismatch')
  if(warehouse&&r.warehouseId&&warehouse!==r.warehouseId)issues.push('consumption_warehouse_mismatch')
 }
 const items:SkuProcurementSource[]=[]
 for(const[skuId,d]of demand){
  const rows=records.filter(r=>r.skuId===skuId),sums={'10':new Quantity(0),'11':new Quantity(0),'20':new Quantity(0),'21':new Quantity(0)}
  for(const r of rows)if(!r.issues.length)sums[(r.stockType!+r.status!) as keyof typeof sums]=sums[(r.stockType!+r.status!) as keyof typeof sums].plus(r.quantity!)
  const full=sums['10'].plus(sums['11']),deposit=sums['20'].plus(sums['21']),direct=d.quantity.minus(full).minus(deposit)
  const complete=!issues.length&&direct.gte(0)
  if(direct.lt(0))issues.push('consumption_exceeds_demand')
  items.push({skuId,sku:d.sku,lineIds:d.lineIds,demandQuantity:d.quantity.toFixed(),fullPaymentQuantity:complete?full.toFixed():null,depositQuantity:complete?deposit.toFixed():null,directQuantity:complete?direct.toFixed():null,fullPaymentReserved:complete?sums['10'].toFixed():null,fullPaymentUsed:complete?sums['11'].toFixed():null,depositReserved:complete?sums['20'].toFixed():null,depositUsed:complete?sums['21'].toFixed():null,complete,records:rows})
 }
 // A bad/unknown allocation may belong to any SKU. Do not publish a partially trusted split.
 if(issues.length)for(const i of items){i.complete=false;i.directQuantity=i.fullPaymentQuantity=i.depositQuantity=i.fullPaymentReserved=i.fullPaymentUsed=i.depositReserved=i.depositUsed=null}
 return {...base,status:issues.length?'incomplete':'complete',items,issues:[...new Set(issues)]}
}
/** Reject stale summaries after quantity/line changes; metadata can never override native demand. */
export function withProcurementSources(order:Row,sources?:ProcurementSources):Row{
 if(!sources||sources.orderId!==String(order.id)||sources.orderNumber!==order.billno||order.billstatus!=='C')return order
 const {result,issues}=demands(order)
 if(issues.length||result.size!==sources.items.length||sources.items.some(i=>!result.get(i.skuId)?.quantity.eq(i.demandQuantity)||JSON.stringify(result.get(i.skuId)?.lineIds)!==JSON.stringify(i.lineIds)))return order
 const bySku=new Map(sources.items.map(i=>[i.skuId,i]))
 return {...order,hzkj_orders_billentry:(order.hzkj_orders_billentry??[]).map((l:Row)=>({...l,procurementSource:bySku.get(ref(l,'hzkj_local_sku')??'')}))}
}
