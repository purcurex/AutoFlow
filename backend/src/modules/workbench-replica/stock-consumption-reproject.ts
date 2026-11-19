import {physicalBusinessProjection} from '../fop-data/physical-business-projection'
import {readStockConsumptionSnapshot} from './collected-stock-consumptions'
type Row=Record<string,any>
type Query={query:(sql:string,params?:any[])=>Promise<any>}
/** Local publication only. Caller commits consumption replacement and dependent order changes together. */
export async function reprojectStockConsumptionOrders(q:Query,batchId:string,orderNumbers:string[]){
 if(!orderNumbers.length)return 0
 const [batch]=await q.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[batchId])
 const orders:Row[]=await q.query('SELECT source_id,raw,display FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])',[batchId,orderNumbers])
 const entities:Row[]=await q.query("SELECT entity_type,source_id,raw,display FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type IN ('product','purchase','purchase_application')",[batchId])
 const products=new Map<string,Row>(),purchases=new Map<string,Row[]>(),applications=new Map<string,Row[]>()
 for(const e of entities){
  if(e.entity_type==='product')products.set(e.source_id,e.raw)
  if(e.entity_type==='purchase')for(const id of new Set<string>((e.display.rows??[]).map((r:Row)=>r.orderId).filter(Boolean)))purchases.set(id,[...(purchases.get(id)??[]),e])
  if(e.entity_type==='purchase_application')for(const number of new Set<string>((e.raw.entryentity??[]).map((r:Row)=>r.hzkj_srcbillnumber).filter(Boolean)))applications.set(number,[...(applications.get(number)??[]),e.raw])
 }
 const snapshot=await readStockConsumptionSnapshot(q,batchId,batch.metadata,orderNumbers)
 const changed=orders.map(o=>{
  const next=physicalBusinessProjection(o.raw,o.display,products,purchases.get(o.source_id) as {raw:Row;display:Row}[]??[],applications.get(o.raw.billno)??[],snapshot)
  return {source_id:o.source_id,display:next}
 }).filter((o,i)=>JSON.stringify(o.display)!==JSON.stringify(orders[i].display))
 for(let start=0;start<changed.length;start+=300)await q.query(`UPDATE hz_fop_collected_orders o SET display=r.display FROM jsonb_to_recordset($2::jsonb) r(source_id text,display jsonb) WHERE o.batch_id=$1 AND o.source_id=r.source_id`,[batchId,JSON.stringify(changed.slice(start,start+300))])
 return changed.length
}
