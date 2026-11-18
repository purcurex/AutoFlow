// Explicit field-only repair from a complete company capture. No upstream requests.
const fs=require('fs'),path=require('path'),{createHash}=require('crypto'),{parseEnv,isDeepStrictEqual}=require('util')
function collect(directory){
 const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))
 if(!m.complete||m.companyId!=='100000'||m.context?.tenantId!=='hyperzone.test'||m.entityType!=='fulfillment'||m.coverage!=='full_company_scan')throw Error('invalid_capture')
 const rows=[],seen=new Set(),states={};let expected
 for(const [i,page]of m.pages.entries()){
  const raw=fs.readFileSync(path.join(directory,page.file),'utf8')
  if(createHash('sha256').update(raw).digest('hex')!==page.sha256)throw Error('capture_hash_mismatch')
  const b=JSON.parse(raw),d=b.data
  if(b.status!==true||String(b.errorCode)!=='0'||!d?.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'")||d.pageNo!==i+1||d.rows.length!==page.rows||d.lastPage!==(i===m.pages.length-1))throw Error('invalid_capture_page')
  expected??=d.totalCount;if(expected!==d.totalCount)throw Error('capture_total_changed')
  for(const row of d.rows){
   if(typeof row.id!=='string'||!/^[1-9]\d*$/.test(row.id)||seen.has(row.id)||!row.billno||!Object.hasOwn(row,'hzkj_delivery_status'))throw Error('outbound_capture_incomplete')
   if(![null,'','0','1','2'].includes(row.hzkj_delivery_status))throw Error('invalid_outbound_status')
   seen.add(row.id);states[row.hzkj_delivery_status||'unknown']=(states[row.hzkj_delivery_status||'unknown']||0)+1
   rows.push(Object.fromEntries(['id','billno','org_id','hzkj_operator_id','modifytime','billstatus','hzkj_orderstatus','hzkj_receipt_status','hzkj_delivery_status'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])))
  }
 }
 if(rows.length!==m.rowCount||rows.length!==expected)throw Error('capture_count_mismatch')
 return {rows,manifest:m,states}
}
async function main(){
 const [mode,directory,reportPath,backupPath]=process.argv.slice(2)
 if(!['--dry-run','--rehearsal','--execute'].includes(mode)||!directory||!reportPath||!backupPath)throw Error('explicit_mode_capture_report_backup_required')
 const capture=collect(directory),backup=JSON.parse(fs.readFileSync(backupPath,'utf8'))
 if(!backup.backupRestoreVerified||createHash('sha256').update(fs.readFileSync(backup.backup)).digest('hex')!==backup.sha256)throw Error('verified_backup_required')
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(e.DB_DATABASE!=='autoflow_local_demo'||e.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(e.DB_HOST))throw Error('local_database_required')
 if(mode==='--rehearsal'&&!/^hz_outbound_restore_\d+$/.test(backup.restoreDatabase))throw Error('rehearsal_database_required')
 require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
 const {supplementOutboundStatus}=require('../backend/src/modules/fop-data/collected-outbound-supplement'),{Client}=require('pg')
 const db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:mode==='--rehearsal'?backup.restoreDatabase:e.DB_DATABASE});await db.connect()
 const factsHash=async()=> (await db.query(`SELECT count(*)::int total,md5(string_agg(md5((raw-'hzkj_delivery_status')::text||(display-ARRAY['sourceOutboundStatus','businessStatus','nativeAssociationIssues','outboundCapture'])::text),'' ORDER BY source_id)) other_facts_hash FROM hz_fop_collected_orders WHERE batch_id=$1`,[batch.id])).rows[0]
 let batch;const report={capturedAt:capture.manifest.capturedAt,captureRows:capture.rows.length,states:capture.states,mode,matched:0,changed:0,missingLocal:0,conflicts:[],automaticCallsEnabled:false,upstreamCalled:false,consistentSnapshot:false}
 try{
  await db.query('BEGIN');const b=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")
  if(b.rows.length!==1||b.rows[0].company_id!=='100000'||b.rows[0].tenant_id!=='hyperzone.test')throw Error('batch_scope_mismatch');batch=b.rows[0]
  report.before=await factsHash()
  for(let i=0;i<capture.rows.length;i+=250){
   const source=capture.rows.slice(i,i+250),stored=await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) FOR UPDATE',[batch.id,source.map(s=>s.id)]),map=new Map(stored.rows.map(r=>[r.source_id,r])),patches=[]
   for(const s of source){const prior=map.get(s.id);if(!prior){report.missingLocal++;continue}report.matched++
    let next;try{next=supplementOutboundStatus(prior,s,{companyId:'100000',capturedAt:capture.manifest.capturedAt})}catch(e){report.conflicts.push({orderNumber:s.billno,reason:e.message});continue}
    const keys=['sourceOutboundStatus','businessStatus','nativeAssociationIssues','outboundCapture'],patch=Object.fromEntries(keys.map(k=>[k,next.display[k]]))
    if(isDeepStrictEqual(prior.raw,next.raw)&&prior.raw_delivery_status===next.raw_delivery_status&&keys.every(k=>isDeepStrictEqual(prior.display[k],next.display[k])))continue
    report.changed++;patches.push({id:s.id,sourceStatus:s.hzkj_delivery_status,status:next.raw_delivery_status,display:patch})
   }
   if(patches.length)await db.query(`UPDATE hz_fop_collected_orders o SET raw=o.raw||jsonb_build_object('hzkj_delivery_status',x->'sourceStatus'),raw_delivery_status=x->>'status',display=o.display||(x->'display') FROM jsonb_array_elements($2::jsonb) x WHERE o.batch_id=$1 AND o.source_id=x->>'id'`,[batch.id,JSON.stringify(patches)])
  }
  report.after=await factsHash();if(report.before.total!==report.after.total||report.before.other_facts_hash!==report.after.other_facts_hash)throw Error('unrelated_facts_changed')
  if(report.conflicts.length)throw Error('outbound_source_conflicts')
  report.notReturnedBySource=report.before.total-report.matched
  const counts=await db.query("SELECT raw_delivery_status,display->'businessStatus'->>'outbound' outbound,count(*)::int n FROM hz_fop_collected_orders WHERE batch_id=$1 GROUP BY 1,2 ORDER BY 1,2",[batch.id]);report.afterStates=counts.rows
  if(mode!=='--dry-run')await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||jsonb_build_object('fulfillment_outbound',$2::jsonb)) WHERE id=$1",[batch.id,JSON.stringify({capturedAt:capture.manifest.capturedAt,companyId:'100000',coverage:'full_company_scan',field:'hzkj_delivery_status',matched:report.matched,sourceRows:report.captureRows,consistentSnapshot:false})])
  await db.query(mode==='--dry-run'?'ROLLBACK':'COMMIT');report.committed=mode!=='--dry-run'
 }catch(e){await db.query('ROLLBACK');report.committed=false;report.error=e.message;process.exitCode=1}finally{await db.end()}
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))
}
module.exports={collect};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1})
