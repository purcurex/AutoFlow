// Scheduled relation reads. Only committed local facts are shown by page queries.
export async function seedRelationCompensation(db,batchId){
 // Initial backlog and periodic checks include historical roots: fairness is by oldest check.
 await db.query(`INSERT INTO hz_fop_relation_refresh(batch_id,root_kind,root_id,root_number,requested_version,published_version)
 SELECT batch_id,'fulfillment',source_id,order_number,0,-1 FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number IS NOT NULL
 UNION ALL SELECT batch_id,'stock',source_id,display->>'stockNumber',0,-1 FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' AND coalesce(display->>'stockNumber','')<>''
 ON CONFLICT DO NOTHING`,[batchId])
}
export async function refreshRelations({db,batchId,query,normalize,limit=500,enabled=()=>true,number=null}){
 const tasks=await db.query(`SELECT * FROM hz_fop_relation_refresh WHERE batch_id=$1 AND next_attempt_at<=now() AND ($3::text IS NULL OR root_number=$3)
 AND (requested_version<>published_version OR checked_at IS NULL OR checked_at<now()-interval '24 hours')
 ORDER BY (requested_version>0 AND requested_version<>published_version) DESC,checked_at ASC NULLS FIRST,updated_at,root_id LIMIT $2`,[batchId,limit,number])
 const report={requested:0,published:0,incomplete:0,failed:0,superseded:0}
 for(const task of tasks){if(!enabled())break;report.requested++
 try{
 const result=await query(relationQueryParameters(task))
 if(!result.report.success||!result.raw)throw Error(result.report.errorCategory??'relation_query_failed')
 const raw=JSON.parse(result.raw).data,at=new Date().toISOString();const graph=normalize(raw,{id:task.root_id,number:task.root_number,kind:task.root_kind},at)
 if(!graph.complete){report.incomplete++;throw Error('relation_response_incomplete')}
 const published=await db.transaction(async q=>{
 const [current]=await q.query('SELECT * FROM hz_fop_relation_refresh WHERE batch_id=$1 AND root_kind=$2 AND root_id=$3 FOR UPDATE',[batchId,task.root_kind,task.root_id])
 if(!current||String(current.requested_version)!==String(task.requested_version))return false
 const [batch]=await q.query("SELECT id FROM hz_fop_collected_batches WHERE id=$1 AND state='active'",[batchId]);if(!batch)return false
 await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'api_bill_relations',$2,'','{}',$3,$4)
 ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=excluded.raw,captured_at=excluded.captured_at`,[batchId,task.root_kind+':'+task.root_id,JSON.stringify(raw),at])
 await q.query(`UPDATE hz_fop_relation_refresh SET published_version=requested_version,checked_at=$4,attempts=0,last_error=null,next_attempt_at=$4::timestamptz+interval '24 hours' WHERE batch_id=$1 AND root_kind=$2 AND root_id=$3`,[batchId,task.root_kind,task.root_id,at]);return true
 });if(published)report.published++;else report.superseded++
 }catch(error){report.failed++;await db.query(`UPDATE hz_fop_relation_refresh SET attempts=attempts+1,updated_at=now(),last_error=$4,next_attempt_at=now()+make_interval(mins=>LEAST(120,30*power(2,LEAST(attempts,2))::int)) WHERE batch_id=$1 AND root_kind=$2 AND root_id=$3 AND requested_version=$5`,[batchId,task.root_kind,task.root_id,String(error.message).slice(0,150),task.requested_version]);if(fatalRelationRead(error.message))throw error}
 }
 const [pending]=await db.query('SELECT count(*)::int count FROM hz_fop_relation_refresh WHERE batch_id=$1 AND requested_version<>published_version',[batchId]);return {...report,pending:pending?.count??0}
}

export const relationQueryParameters=task=>({operation:task.root_kind==='stock'?'stock-relations':'bill-relations',[task.root_kind==='stock'?'stockOrderNo':'orderNo']:task.root_number,level:'BILL',saveResponse:true})

export const fatalRelationRead=code=>['timestamp_source_unauthorized','timestamp_source_forbidden','timestamp_source_rate_limited','timestamp_source_unavailable','fop_queries_paused'].some(k=>String(code).includes(k))
