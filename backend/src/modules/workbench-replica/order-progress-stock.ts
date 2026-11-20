import type { DataSource } from 'typeorm'
import { readCollectedChain } from './collected-chain-query'
type Row=Record<string,any>
/** Follow current consumption identities, never infer stock ownership from a shared SKU. */
export async function readConsumedStockChains(db:Pick<DataSource,'query'>,batch:Row,employees:readonly string[]|null,orderNumber:string){
 const rows:Row[]=await db.query(`SELECT c.stock_id,e.display->>'stockNumber' number,c.record_id,c.use_status,c.quantity::text quantity,c.payload
 FROM hz_fop_collected_stock_consumptions c
 JOIN hz_fop_collected_entities e ON e.batch_id=c.batch_id AND e.entity_type='stock_orders' AND e.source_id=c.stock_id
 WHERE c.batch_id=$1 AND c.order_number=$2 AND c.use_status IN ('0','1') AND c.quantity>0
 AND c.payload->>'stockNumber'=e.display->>'stockNumber'
 AND ($3::text[] IS NULL OR e.owner_employee_id=ANY($3::text[]))
 ORDER BY c.stock_id,c.record_id`,[batch.id,orderNumber,employees])
 const grouped=new Map<string,Row>()
 for(const r of rows){
  const group=grouped.get(r.stock_id)??{id:r.stock_id,number:r.number,records:[],graph:null}
  group.records.push({id:r.record_id,status:r.use_status==='1'?'已耗用':'预占',quantity:r.quantity.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''),sku:r.payload?.skuNumber??null,usedAt:r.payload?.usedAt??null})
  grouped.set(r.stock_id,group)
 }
 // Sequential small root queries avoid unbounded fan-out when an order consumes many stock batches.
 for(const group of grouped.values()){
  try{group.graph=await readCollectedChain(db,batch,employees,group.id,'stock')}
  catch(e){if(![404,409,503].includes((e as any)?.getStatus?.()))throw e}
 }
 return [...grouped.values()]
}
