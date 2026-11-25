import { relationSnapshotCurrent } from './relation-refresh'
type Row=Record<string,any>
const id=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,30}$/.test(v)
/** A BILL relation establishes document ancestry only, never SKU/quantity allocation. */
export function normalizeApiRelations(raw:Row,root:{id:string;number:string;kind:string},capturedAt:string){
 const entity=root.kind==='stock'?'hzkj_stock_order_new':'hzkj_orders'
 if(raw?.level!=='BILL'||raw.orderId!==root.id||raw.orderNo!==root.number||!Array.isArray(raw.bills)||!Array.isArray(raw.links)||raw.bills.length>2000||raw.links.length>5000)throw Error('relation_root_or_shape_invalid')
 const nodes=new Map<string,Row>()
 for(const b of raw.bills){
  if(!id(b.billId)||typeof b.entity!=='string'||!(/^(?:hzkj|im)_[a-z0-9_]+$/.test(b.entity))||typeof b.billNo!=='string'||!b.billNo.trim())throw Error('relation_document_invalid')
  const key=b.entity+':'+b.billId
  if(nodes.has(key)&&nodes.get(key)!.number!==b.billNo)throw Error('relation_document_conflict')
  nodes.set(key,{id:key,entity:b.entity,sourceId:b.billId,number:b.billNo,billStatus:b.billStatus||null,businessStatus:null,capturedAt})
 }
 const rootKey=entity+':'+root.id;if(!nodes.has(rootKey))throw Error('relation_root_missing');if(nodes.get(rootKey)!.number!==root.number)throw Error('relation_root_number_mismatch')
 const edges:Row[]=[]
 for(const l of raw.links){
  const from=l.sourceEntity+':'+l.sourceBillId,to=l.targetEntity+':'+l.targetBillId
  if(!nodes.has(from)||!nodes.has(to)||from===to)throw Error('relation_endpoint_invalid')
  edges.push({id:from+'->'+to,fromDocumentId:from,toDocumentId:to,type:'source_document',basis:l.basis||'FOP_BILL_RELATION'})
 }
 // Do not disclose sibling orders of a merged purchase or downstream reverse cycles.
 const visible=new Set([rootKey]);let changed=true
 while(changed){changed=false;for(const e of edges){const n=nodes.get(e.toDocumentId)!
  if(visible.has(e.fromDocumentId)&&!visible.has(n.id)&&!['hzkj_orders','hzkj_stock_order_new'].includes(n.entity)){visible.add(n.id);changed=true}
 }}
 return {rootDocumentId:rootKey,documents:[...nodes.values()].filter(n=>visible.has(n.id)),relations:[...new Map(edges.filter(e=>visible.has(e.fromDocumentId)&&visible.has(e.toDocumentId)).map(e=>[e.id,e])).values()],builtAt:capturedAt,complete:raw.complete===true,issues:raw.issues??[],quantityComplete:false}
}
/** Root authorization is performed by readOrderProgress before calling this function. */
export async function readApiRelations(db:{query:Function},batchId:string,root:{source_id:string;number:string;kind:string}){
 const [stored]=await db.query("SELECT raw,captured_at FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='api_bill_relations' AND source_id=$2",[batchId,root.kind+':'+root.source_id])
 if(!stored)return null
 const [task]=await db.query("SELECT requested_version,published_version,checked_at FROM hz_fop_relation_refresh WHERE batch_id=$1 AND root_kind=$2 AND root_id=$3",[batchId,root.kind,root.source_id])
 if(!relationSnapshotCurrent(task)||new Date(task.checked_at).getTime()!==new Date(stored.captured_at).getTime())return null
 const graph=normalizeApiRelations(stored.raw,{id:root.source_id,number:root.number,kind:root.kind},new Date(stored.captured_at).toISOString())
 const ids=graph.documents.filter(n=>n.entity==='hzkj_purorderbill').map(n=>n.sourceId)
 if(ids.length){const purchases=await db.query("SELECT source_id,raw->>'hzkj_pay_status' payment FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND source_id=ANY($2::text[])",[batchId,ids]);const labels:Row={'0':'未支付','1':'已支付','2':'未支付已取消','3':'已退款','4':'部分退款'};for(const node of graph.documents){const p=purchases.find((p:Row)=>p.source_id===node.sourceId);if(node.entity==='hzkj_purorderbill'&&p)node.businessStatus=labels[p.payment]??null}}
 return graph
}
