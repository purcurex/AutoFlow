/* Explicit offline projection rebuild. Never calls FOP; raw and native state columns are immutable. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{parseEnv}=require('node:util')
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
const {withOrderBusinessStatus}=require('../backend/src/modules/fop-data/order-business-status')
const {collectedWhere}=require('../backend/src/modules/workbench-replica/collected-workbench-query')
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
async function run(){
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),apply=process.argv.includes('--apply')
 if(!apply&&!process.argv.includes('--dry-run'))throw Error('explicit_mode_required')
 if(e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='55432'||e.DB_DATABASE!=='autoflow_local_demo'||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false')throw Error('paused_local_database_required')
 const {Client}=require('pg'),db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect()
 try{
  await db.query(apply?'BEGIN':'BEGIN READ ONLY')
  const {rows:batches}=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000'"+(apply?' FOR UPDATE':''));if(batches.length!==1)throw Error('unique_active_batch_required')
  const b=batches[0],hash=createHash('sha256'),report={mode:apply?'apply':'dry-run',rows:0,changed:0,purchase:{},outbound:{},order:{},missingFields:{},queues:{},fopRequests:0}
  let cursor='',backup
  if(apply){fs.mkdirSync('.runtime/business-status',{recursive:true});backup=`.runtime/business-status/before-${Date.now()}.jsonl`;fs.writeFileSync(backup,JSON.stringify({batchId:b.id,metadata:b.metadata})+'\n',{mode:0o600,flag:'wx'})}
  while(true){
   const {rows}=await db.query('SELECT source_id,display,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id>$2 ORDER BY source_id LIMIT 500'+(apply?' FOR UPDATE':''),[b.id,cursor]);if(!rows.length)break
   const updates=[]
   for(const r of rows){hash.update(JSON.stringify(r.raw));const s=withOrderBusinessStatus(r.display,r.raw).businessStatus;if(!s)throw Error('invalid_source_identity');report.rows++
    for(const k of ['purchase','outbound','order'])report[k][s[k]]=(report[k][s[k]]??0)+1
    for(const k of s.missingFields)report.missingFields[k]=(report.missingFields[k]??0)+1
    if(JSON.stringify(canonical(r.display.businessStatus))!==JSON.stringify(canonical(s))){report.changed++;updates.push({id:r.source_id,status:s});if(apply)fs.appendFileSync(backup,JSON.stringify({id:r.source_id,existed:Object.hasOwn(r.display,'businessStatus'),businessStatus:r.display.businessStatus??null})+'\n')}
   }
   if(apply&&updates.length)await db.query("UPDATE hz_fop_collected_orders o SET display=jsonb_set(o.display,'{businessStatus}',x.status) FROM jsonb_to_recordset($2::jsonb) x(id text,status jsonb) WHERE o.batch_id=$1 AND o.source_id=x.id",[b.id,JSON.stringify(updates)])
   cursor=rows.at(-1).source_id
  }
  report.rawSha256=hash.digest('hex')
  if(apply){const after=createHash('sha256');cursor='';while(true){const {rows}=await db.query('SELECT source_id,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id>$2 ORDER BY source_id LIMIT 500',[b.id,cursor]);if(!rows.length)break;for(const r of rows)after.update(JSON.stringify(r.raw));cursor=rows.at(-1).source_id}if(after.digest('hex')!==report.rawSha256)throw Error('raw_changed');report.rawUnchanged=true
   await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{businessStatusProjection}',$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({version:1,rawSha256:report.rawSha256,rows:report.rows})])
  }
  for(const queue of ['dispatch','shipping'])for(const completed of [false,true]){const q=collectedWhere(b.id,null,{queue,completed,timeRange:'all'});report.queues[`${queue}_${completed?'completed':'pending'}`]=(await db.query(`SELECT count(*)::int n FROM hz_fop_collected_orders WHERE ${q.where}`,q.params)).rows[0].n}
  await db.query(apply?'COMMIT':'ROLLBACK')
  console.log(JSON.stringify(report,null,2))
 }catch(error){await db.query('ROLLBACK');throw error}finally{await db.end()}
}
run().catch(e=>{console.error(e.message);process.exitCode=1})
