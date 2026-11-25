type Db={query:Function}
/** Reconcile changed targets against newly rebuilt paths; old roots were queued by source triggers. */
export async function enqueueChangedRelations(db:Db,batchId:string){
 await db.query(`SELECT hz_enqueue_relation_root($1,CASE WHEN root.entity_code='hzkj_stock_order_new' THEN 'stock' ELSE 'fulfillment' END,root.source_id,root.document_number)
 FROM (SELECT DISTINCT p.order_document_id FROM hz_fop_relation_dirty_sources dirty
 JOIN hz_fop_collected_chains c ON c.batch_id=dirty.batch_id
 JOIN hz_fop_source_documents doc ON doc.dataset_id=c.dataset_id AND doc.entity_code=dirty.entity_code AND doc.source_id=dirty.source_id
 JOIN hz_fop_document_relations r ON r.dataset_id=doc.dataset_id AND (r.from_document_id=doc.id OR r.to_document_id=doc.id)
 JOIN hz_fop_order_relation_paths p ON p.dataset_id=doc.dataset_id AND p.relation_id=r.id WHERE dirty.batch_id=$1) roots
 JOIN hz_fop_source_documents root ON root.id=roots.order_document_id`,[batchId])
 const candidates=await db.query(`SELECT e.raw FROM hz_fop_collected_entities e JOIN hz_fop_relation_dirty_sources d ON d.batch_id=e.batch_id AND d.source_id=e.source_id WHERE d.batch_id=$1 AND e.entity_type<>'api_bill_relations'`,[batchId])
 const numbers=[...new Set(candidates.flatMap((r:any)=>explicitRelationNumbers(r.raw)))]
 if(numbers.length){await db.query("SELECT hz_enqueue_relation_root($1,'fulfillment',source_id,order_number) FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])",[batchId,numbers]);await db.query("SELECT hz_enqueue_relation_root($1,'stock',source_id,display->>'stockNumber') FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' AND display->>'stockNumber'=ANY($2::text[])",[batchId,numbers])}
 await db.query('DELETE FROM hz_fop_relation_dirty_sources WHERE batch_id=$1',[batchId])
}
export function relationSnapshotCurrent(task:any,now=Date.now()){
 return !!task&&String(task.requested_version)===String(task.published_version)&&!!task.checked_at&&now-new Date(task.checked_at).getTime()<86400000
}

/** Whitelisted source-reference fields only; never infer an association from SKU or arbitrary text. */
export function explicitRelationNumbers(raw:any):string[]{
 const keys=new Set(['hzkj_salbillnumber','hzkj_srcbillnumber','hzkj_srcnumber','hzkj_src_order','hzkj_src_bill','hzkj_order_no','hzkj_entry_billno','hzkj_sale_order_billno']);const out=new Set<string>();
 const walk=(v:any,depth:number)=>{if(!v||typeof v!=='object'||depth>30)return;for(const [k,x]of Object.entries(v)){if(keys.has(k)&&typeof x==='string'&&x.trim())out.add(x.trim());else if(x&&typeof x==='object')walk(x,depth+1)}};walk(raw,0);return [...out]
}
