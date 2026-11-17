import { createHash, randomUUID } from 'node:crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { publishTimestampProjections } from './timestamp-projection-publisher'
import { rebuildCollectedChain } from './collected-chain-storage'
import { normalizeCollectedOrder } from '../fop-data/collected-order-normalizer'
import { sourceTime, type TimestampScope, type TimestampSession, type TimestampStore, type TimestampDocument, type TimestampMode, type TimestampQuery } from './timestamp-sync'

type Row=Record<string,any>
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Row)[k])).join(',')+'}'
 return JSON.stringify(value)
}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')

/** One session lock covers capture and merge. A crashed process loses its lock, never its W. */
export class TimestampPostgresStore implements TimestampStore {
 constructor(private readonly db:DataSource){}
 async exclusive<T>(scope:TimestampScope,work:(session:TimestampSession)=>Promise<T>):Promise<T>{
  const q=this.db.createQueryRunner();await q.connect()
  // Batch-wide serialization also protects shared order relations across entity workers.
  const key=`timestamp:${scope.batchId}`;let locked=false
  try{
   const [lock]=await q.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])
   if(!lock.locked)throw Error('timestamp_scope_busy');locked=true
   const [batch]=await q.query("SELECT * FROM hz_fop_collected_batches WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active'",[scope.batchId,scope.tenantId,scope.companyId])
   if(!batch)throw Error('timestamp_batch_scope_invalid')
   await q.query("UPDATE hz_fop_timestamp_runs SET state='failed',error_code='timestamp_interrupted',finished_at=now() WHERE batch_id=$1 AND state='running'",[scope.batchId])
   return await work(new PgTimestampSession(q,scope))
  }finally{
   if(q.isTransactionActive)await q.rollbackTransaction()
   try{if(locked)await q.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key])}finally{await q.release()}
  }
 }
}
class PgTimestampSession implements TimestampSession {
 private hasDependentSnapshot=false
 constructor(private readonly q:QueryRunner,private readonly scope:TimestampScope){}
 private get identity(){return [this.scope.batchId,this.scope.entityCode]}
 async checkpoint(){const [row]=await this.q.query('SELECT watermark FROM hz_fop_timestamp_state WHERE batch_id=$1 AND entity_code=$2',this.identity);return row?.watermark??null}
 async lastFullCapture(){const [row]=await this.q.query("SELECT finished_at FROM hz_fop_timestamp_runs WHERE batch_id=$1 AND entity_code=$2 AND mode IN ('initialize','reconcile') AND state IN ('applied','projection_pending') ORDER BY finished_at DESC LIMIT 1",this.identity);return row?.finished_at?new Date(row.finished_at).toISOString():null}
 async start(mode:TimestampMode,lower:string|null,upper:string|null){
  const id=randomUUID()
  await this.q.query("INSERT INTO hz_fop_timestamp_runs(id,batch_id,entity_code,mode,state,lower_bound,upper_bound) VALUES($1,$2,$3,$4,'running',$5,$6)",[id,...this.identity,mode,lower,upper]);return id
 }
 async stage(runId:string,rows:TimestampDocument[],query:TimestampQuery){
  await this.q.startTransaction()
  try{
   const [run]=await this.q.query("SELECT page_count,row_count FROM hz_fop_timestamp_runs WHERE id=$1 AND batch_id=$2 AND entity_code=$3 AND state='running' FOR UPDATE",[runId,...this.identity])
   if(!run||run.row_count+rows.length>200000)throw Error('timestamp_staging_limit')
   await this.q.query('INSERT INTO hz_fop_timestamp_pages(run_id,page_index,query,documents,payload_hash) VALUES($1,$2,$3,$4,$5)',[runId,run.page_count,JSON.stringify(query),JSON.stringify(rows),digest(rows)])
   await this.q.query('UPDATE hz_fop_timestamp_runs SET page_count=page_count+1,row_count=row_count+$2 WHERE id=$1',[runId,rows.length])
   await this.q.commitTransaction()
  }catch(e){await this.q.rollbackTransaction();throw e}
 }
 async ids(){
  const rows=await this.q.query('SELECT source_id FROM hz_fop_timestamp_documents WHERE batch_id=$1 AND entity_code=$2 AND NOT removed',this.identity)
  // First initialization must reconcile the already displayed snapshot, not only the new mirror.
  if(this.scope.entityCode==='hzkj_orders')rows.push(...await this.q.query('SELECT source_id FROM hz_fop_collected_orders WHERE batch_id=$1',[this.scope.batchId]))
  return [...new Set<string>(rows.map((r:Row)=>r.source_id))]
 }
 async fail(runId:string,code:string){await this.q.query("UPDATE hz_fop_timestamp_runs SET state='failed',error_code=$2,finished_at=now() WHERE id=$1 AND state='running'",[runId,code])}
 private async project(d:TimestampDocument|null,id:string,runId:string,previous:Row|null){
  const supported=this.scope.entityCode==='hzkj_orders'
  if(supported&&previous){
   const owner=(r:Row|null)=>r?.hzkj_operator?.id??r?.hzkj_operator_id??null
   if(!d||owner(previous)!==owner(d.raw))await this.q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{timestampOwnershipPending}','true'::jsonb) WHERE id=$1",[this.scope.batchId])
  }
  // Linked snapshots must remain a coherent old generation until their projectors are connected.
  // Publishing only a new header would mix current ownership/status with stale allocations/RMA.
  if(supported&&!this.hasDependentSnapshot){
   if(!d)await this.q.query('DELETE FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2',[this.scope.batchId,id])
   else{
    if(d.raw.id!==d.id || !Array.isArray(d.raw.hzkj_orders_billentry))throw Error('timestamp_fulfillment_shape_invalid')
    const row=normalizeCollectedOrder(d.raw,{companyId:this.scope.companyId})
    row.display.dataQuality={...row.display.dataQuality,mode:'timestamp',reasons:['eventual_timestamp_capture','linked_workbench_facts_require_reprojection']}
    // Do not retain facts derived from a different parent/ownership version.
    const columns=Object.keys(row),quoted=columns.map(k=>'"'+k+'"')
    await this.q.query(`INSERT INTO hz_fop_collected_orders(batch_id,${quoted.join(',')}) VALUES($1,${columns.map((_,i)=>'$'+(i+2)).join(',')})
      ON CONFLICT(batch_id,source_id) DO UPDATE SET ${quoted.filter(k=>k!=='"source_id"').map(k=>k+'=excluded.'+k).join(',')}`,
      [this.scope.batchId,...columns.map(k=>typeof (row as Row)[k]==='object'&&(row as Row)[k]!==null?JSON.stringify((row as Row)[k]):(row as Row)[k])])
   }
  }
  // Even a refreshed fulfillment header still needs related entity/analytics projection.
  // Preserve earliest previous state while pending, so A→B→C cannot lose A's old relation.
  await this.q.query(`INSERT INTO hz_fop_timestamp_projection_tasks(batch_id,entity_code,source_id,run_id,state,reason,previous_raw,current_raw,removed)
   VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8) ON CONFLICT(batch_id,entity_code,source_id) DO UPDATE SET
   run_id=excluded.run_id,state='pending',reason=excluded.reason,
   previous_raw=CASE WHEN hz_fop_timestamp_projection_tasks.state='pending' THEN hz_fop_timestamp_projection_tasks.previous_raw ELSE excluded.previous_raw END,
   current_raw=excluded.current_raw,removed=excluded.removed,updated_at=now()`,
   [...this.identity,id,runId,supported?'related_projection_pending':'entity_projection_not_connected',previous?JSON.stringify(previous):null,d?JSON.stringify(d.raw):null,!d])
 }
 async commit(runId:string,watermark:string|null,deleted:string[],authoritative:boolean,captureMetadata:Record<string,unknown>={}){
  await this.q.startTransaction()
  try{
   const [batch]=await this.q.query("SELECT * FROM hz_fop_collected_batches WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active' FOR UPDATE",[this.scope.batchId,this.scope.tenantId,this.scope.companyId])
   if(!batch)throw Error('timestamp_batch_scope_changed')
   if(captureMetadata.protocol==='ordinary_modified_pages')this.hasDependentSnapshot=true
   for(const table of ['hz_fop_collected_entities','hz_fop_collected_analytics_facts']){
    const [{present}]=await this.q.query('SELECT to_regclass($1) IS NOT NULL AS present',[table])
    if(present){const [{found}]=await this.q.query(`SELECT EXISTS(SELECT 1 FROM ${table} WHERE batch_id=$1) AS found`,[this.scope.batchId]);if(found)this.hasDependentSnapshot=true}
   }
   const [run]=await this.q.query("SELECT * FROM hz_fop_timestamp_runs WHERE id=$1 AND batch_id=$2 AND entity_code=$3 AND state='running' FOR UPDATE",[runId,...this.identity])
   if(!run)throw Error('timestamp_run_unavailable')
   let changed=0
   for(let page=0;page<run.page_count;page++){
    const [part]=await this.q.query('SELECT documents,payload_hash FROM hz_fop_timestamp_pages WHERE run_id=$1 AND page_index=$2',[runId,page])
    if(!part||digest(part.documents)!==part.payload_hash)throw Error('timestamp_staging_corrupt')
    for(const d of part.documents as TimestampDocument[]){
     const [prior]=await this.q.query('SELECT * FROM hz_fop_timestamp_documents WHERE batch_id=$1 AND entity_code=$2 AND source_id=$3 FOR UPDATE',[...this.identity,d.id])
     const hash=digest(d.raw)
     if(prior&&!prior.removed&&prior.payload_hash===hash&&prior.created_at===d.createdAt&&prior.modified_at===d.modifiedAt)continue
     if(prior&&!prior.removed&&sourceTime(d.modifiedAt??d.createdAt)<sourceTime(prior.modified_at??prior.created_at)){
      // A later stream can repeat an older version already superseded in this same run.
      if(prior.last_run_id===runId)continue
      if(!authoritative)throw Error('timestamp_older_source_conflict')
     }
     const previous=prior?.raw??(this.scope.entityCode==='hzkj_orders'?(await this.q.query('SELECT raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2',[this.scope.batchId,d.id]))[0]?.raw:null)
     await this.q.query(`INSERT INTO hz_fop_timestamp_documents(batch_id,entity_code,source_id,company_id,created_at,modified_at,raw,payload_hash,last_run_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(batch_id,entity_code,source_id) DO UPDATE SET company_id=excluded.company_id,
      created_at=excluded.created_at,modified_at=excluded.modified_at,raw=excluded.raw,payload_hash=excluded.payload_hash,last_run_id=excluded.last_run_id,removed=false,captured_at=now()`,
      [...this.identity,d.id,d.companyId,d.createdAt,d.modifiedAt,JSON.stringify(d.raw),hash,runId])
     await this.project(d,d.id,runId,previous??null);changed++
    }
   }
   for(const id of deleted){
    const [prior]=await this.q.query('SELECT raw FROM hz_fop_timestamp_documents WHERE batch_id=$1 AND entity_code=$2 AND source_id=$3',[...this.identity,id])
    const previous=prior?.raw??(this.scope.entityCode==='hzkj_orders'?(await this.q.query('SELECT raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2',[this.scope.batchId,id]))[0]?.raw:null)
    await this.q.query(`INSERT INTO hz_fop_timestamp_documents(batch_id,entity_code,source_id,company_id,raw,payload_hash,last_run_id,removed)
     VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT(batch_id,entity_code,source_id) DO UPDATE SET removed=true,last_run_id=excluded.last_run_id,captured_at=now()`,[...this.identity,id,this.scope.companyId,JSON.stringify(previous??{}),digest(previous??{}),runId])
    await this.project(null,id,runId,previous??null);changed++
   }
   const publication=captureMetadata.protocol==='ordinary_modified_pages'?await publishTimestampProjections(this.q,this.scope):null
   const [{count}]=await this.q.query("SELECT count(*)::int count FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1 AND entity_code=$2 AND state='pending'",this.identity)
   const state=count?'projection_pending':'applied'
   await this.q.query(`INSERT INTO hz_fop_timestamp_state(batch_id,entity_code,watermark) VALUES($1,$2,$3)
    ON CONFLICT(batch_id,entity_code) DO UPDATE SET watermark=excluded.watermark,updated_at=now()`,[...this.identity,watermark])
   await this.q.query('UPDATE hz_fop_timestamp_runs SET state=$2,finished_at=now() WHERE id=$1',[runId,state])
   const meta={...captureMetadata,runId,watermark,state,changed,pendingProjection:count,presentation:this.hasDependentSnapshot?'previous_snapshot':'primary_header_only',consistentSnapshot:false,capturedAt:new Date().toISOString()}
   if(publication){Object.assign(meta,{publicationPending:!publication.available||count>0,presentation:publication.available?(count?'partial_local_projection':'current_local_projection'):'previous_snapshot',publication})}
   for(const entity of publication?.publishedEntities??[]){if(entity===this.scope.entityCode)continue;const [{n}]=await this.q.query("SELECT count(*)::int n FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1 AND entity_code=$2 AND state='pending'",[this.scope.batchId,entity]);await this.q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,ARRAY['timestampSync',$2],coalesce(metadata->'timestampSync'->$2,'{}'::jsonb)||$3::jsonb) WHERE id=$1 AND metadata->'timestampSync' ? $2",[this.scope.batchId,entity,JSON.stringify({state:n?'projection_pending':'applied',pendingProjection:n,publicationPending:n>0,presentation:n?'partial_local_projection':'current_local_projection'})])}
   await this.q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{timestampSync}',coalesce(metadata->'timestampSync','{}'::jsonb)||$2::jsonb) WHERE id=$1",[this.scope.batchId,JSON.stringify({[this.scope.entityCode]:meta})])
   if(this.scope.entityCode==='hzkj_orders'||publication?.applied)await this.q.query('UPDATE hz_fop_collected_batches SET row_count=(SELECT count(*) FROM hz_fop_collected_orders WHERE batch_id=$1) WHERE id=$1',[this.scope.batchId])
   if(publication?.rebuildChain)await rebuildCollectedChain(this.q.manager,this.scope.batchId)
   await this.q.commitTransaction();return {...meta}
  }catch(error){await this.q.rollbackTransaction();throw error}
 }
}
