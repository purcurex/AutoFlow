import { createHash } from 'node:crypto'
import { normalizeStockConsumptions, type StockConsumptionSnapshot } from '../fop-data/stock-consumption-source'
type Query={query:(sql:string,params?:any[])=>Promise<any>}
type Row=Record<string,any>
export const stockConsumptionTableSql=`CREATE TABLE hz_fop_collected_stock_consumptions (
 batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
 stock_id text NOT NULL, record_id text NOT NULL, order_number text NOT NULL, sku_id text,
 stock_type text, use_status text, quantity numeric(24,8), payload jsonb NOT NULL,
 captured_at timestamptz NOT NULL, PRIMARY KEY(batch_id,stock_id,record_id))`
const canonical=(v:any):string=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'):JSON.stringify(v)
/** Caller owns the transaction and batch row lock; only a complete successful company scan may replace children. */
export async function replaceStockConsumptionSnapshot(q:Query,batchId:string,companyId:string,stocks:Row[],capturedAt:string){
 if(!Number.isFinite(Date.parse(capturedAt))||!/(Z|[+-]\d{2}:\d{2})$/.test(capturedAt))throw Error('consumption_capture_time_invalid')
 const [batch]=await q.query('SELECT company_id,metadata FROM hz_fop_collected_batches WHERE id=$1 FOR UPDATE',[batchId])
 if(!batch||batch.company_id!==companyId)throw Error('consumption_batch_company_mismatch')
 const ids=stocks.map(s=>String(s.id));if(new Set(ids).size!==ids.length)throw Error('consumption_duplicate_stock_document')
 const records=normalizeStockConsumptions(stocks,companyId).sort((a,b)=>(a.stockId+':'+a.recordId).localeCompare(b.stockId+':'+b.recordId))
 const revision=createHash('sha256').update(canonical(records)).digest('hex')
 const prior=batch.metadata?.entityCaptures?.stock_consumptions
 if(prior?.capturedAt&&Date.parse(capturedAt)<Date.parse(prior.capturedAt))throw Error('consumption_capture_stale')
 if(prior?.capturedAt&&Date.parse(capturedAt)===Date.parse(prior.capturedAt)&&prior.revision!==revision)throw Error('consumption_capture_version_conflict')
 if(prior?.revision===revision&&prior.complete===true){
  if(prior.capturedAt!==capturedAt)await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures,stock_consumptions}',$2::jsonb) WHERE id=$1",[batchId,JSON.stringify({...prior,capturedAt,stockCount:stocks.length})])
  return {changed:false,affectedOrders:[] as string[],recordCount:records.length,revision}
 }
 const previous:Row[]=await q.query('SELECT stock_id,record_id,order_number,payload FROM hz_fop_collected_stock_consumptions WHERE batch_id=$1',[batchId])
 const old=new Map(previous.map(r=>[r.stock_id+':'+r.record_id,r])),affected=new Set<string>()
 for(const r of records){const key=r.stockId+':'+r.recordId,p=old.get(key);if(!p||canonical(p.payload)!==canonical(r)){affected.add(r.orderNumber);if(p)affected.add(p.order_number)}old.delete(key)}
 for(const r of old.values())affected.add(r.order_number)
 await q.query('DELETE FROM hz_fop_collected_stock_consumptions WHERE batch_id=$1',[batchId])
 for(let offset=0;offset<records.length;offset+=1000)await q.query(`INSERT INTO hz_fop_collected_stock_consumptions(batch_id,stock_id,record_id,order_number,sku_id,stock_type,use_status,quantity,payload,captured_at)
  SELECT $1,r->>'stockId',r->>'recordId',r->>'orderNumber',r->>'skuId',r->>'stockType',r->>'status',(r->>'quantity')::numeric,r,$3::timestamptz FROM jsonb_array_elements($2::jsonb) r`,[batchId,JSON.stringify(records.slice(offset,offset+1000)),capturedAt])
 const capture={companyId,complete:true,revision,capturedAt,stockCount:stocks.length,recordCount:records.length,missingSkuCount:records.filter(r=>!r.skuId).length,consistentSnapshot:false,paymentConfirmsUsage:true}
 await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||jsonb_build_object('stock_consumptions',$2::jsonb)) WHERE id=$1",[batchId,JSON.stringify(capture)])
 // First verified scan also proves absence for other current orders. Later scans touch changed parents only.
 if(!prior?.complete){const orders:Row[]=await q.query("SELECT order_number FROM hz_fop_collected_orders WHERE batch_id=$1 AND raw_bill_status='C'",[batchId]);for(const o of orders)affected.add(o.order_number)}
 return {changed:true,affectedOrders:[...affected],recordCount:records.length,revision}
}
export async function readStockConsumptionSnapshot(q:Query,batchId:string,metadata:Row,orderNumbers:string[]):Promise<StockConsumptionSnapshot|undefined>{
 const capture=metadata?.entityCaptures?.stock_consumptions
 if(!capture)return undefined
 const rows:Row[]=await q.query('SELECT payload FROM hz_fop_collected_stock_consumptions WHERE batch_id=$1 AND order_number=ANY($2::text[]) ORDER BY stock_id,record_id',[batchId,orderNumbers])
 return {complete:capture.complete===true,revision:String(capture.revision),records:rows.map(r=>r.payload)}
}
