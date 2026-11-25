/* Rebuild stock display from already collected same-document facts. No FOP/network API. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
async function refreshStockNative(db,batchId,{backupFile,projector}={}){
 const result=await db.query('SELECT * FROM hz_fop_collected_batches WHERE id=$1 FOR UPDATE',[batchId]);const b=(result.rows??result)[0]
 if(!b||b.state!=='active')throw Error('active_batch_required')
 const existingResult=await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders'",[b.id]),existing=existingResult.rows??existingResult
 const factsResult=await db.query("SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2 AND entity_type='stock' ORDER BY source_id",[b.id,b.company_id]),facts=factsResult.rows??factsResult
 if(!facts.length)return {rows:0,updated:0,inserted:0}
 const projectCollectedStockNative=projector??require('../backend/src/modules/fop-data/collected-stock-native').projectCollectedStockNative
 const byId=new Map(existing.map(r=>[r.source_id,r])),updates=facts.map(f=>({f,display:projectCollectedStockNative(f,b.tenant_id,b.company_id,byId.get(f.source_id))})).filter(r=>r.display)
 if(!updates.length)return {rows:existing.length,updated:0,inserted:0}
 if(backupFile){fs.mkdirSync(path.dirname(backupFile),{recursive:true,mode:0o700});fs.writeFileSync(backupFile,JSON.stringify({batchId:b.id,metadata:b.metadata,rows:existing}),{mode:0o600,flag:'wx'})}
 let inserted=0,updated=0
 for(const {f,display} of updates){const search=[display.stockNumber,display.customerName,display.customerCode,...display.items.flatMap(i=>[i.sku,i.name])].filter(Boolean).join(' ').toLowerCase()
  if(byId.has(f.source_id)){await db.query("UPDATE hz_fop_collected_entities SET display=$3,owner_employee_id=$4,search_text=$5,raw=$6,captured_at=$7 WHERE batch_id=$1 AND entity_type='stock_orders' AND source_id=$2",[b.id,f.source_id,JSON.stringify(display),f.owner_employee_id,search,JSON.stringify(f.raw),f.captured_at]);updated++}
  else {await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,'stock_orders',$2,$3,$4,$5,$6,$7)",[b.id,f.source_id,f.owner_employee_id,search,JSON.stringify(display),JSON.stringify(f.raw),f.captured_at]);inserted++}
 }
 const signature=createHash('sha256').update(JSON.stringify(canonical(updates.map(r=>r.display)))).digest('hex')
 const capturedAt=new Date(Math.max(...updates.map(r=>new Date(r.f.captured_at).valueOf()))).toISOString()
 await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({stock_orders:{...b.metadata?.entityCaptures?.stock_orders,captureId:signature,capturedAt,rowCount:existing.length+inserted,consistentSnapshot:false,nativeStatusProjection:true}})])
 return {rows:existing.length+inserted,updated,inserted}
}
module.exports={refreshStockNative}
if(require.main===module){
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
 const {parseEnv}=require('node:util'),{Client}=require('pg'),e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(process.argv[2]!=='--apply'||e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='55432'||e.DB_DATABASE!=='autoflow_local_demo'||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_SYNC_ENABLED!=='false'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('explicit_local_paused_apply_required')
 ;(async()=>{const db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect();try{await db.query('BEGIN');const {rows}=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000'");if(rows.length!==1)throw Error('unique_batch_required');const result=await refreshStockNative(db,rows[0].id,{backupFile:`.runtime/sales-review-stock/before-${Date.now()}.json`});await db.query('COMMIT');console.log(result)}catch(error){await db.query('ROLLBACK');throw error}finally{await db.end()}})().catch(error=>{console.error(error.message);process.exitCode=1})
}
