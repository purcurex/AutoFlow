// Explicit local field repair. Reads a verified capture; never calls FOP or runs business operations.
const fs=require('node:fs'),path=require('node:path'),{parseEnv,isDeepStrictEqual}=require('node:util'),{createHash}=require('node:crypto');
function collect(directory){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 if(!manifest.complete||manifest.companyId!=='100000'||manifest.context?.tenantId!=='hyperzone.test'||manifest.entityType!=='fulfillment'||manifest.coverage!=='full_company_scan'||!manifest.pages?.length)throw Error('invalid_capture');
 const rows=[],seen=new Set();let total;
 for(const [i,p]of manifest.pages.entries()){
  if(!p||p.file!==`page-${i+1}.json`)throw Error('invalid_page_path');
  const text=fs.readFileSync(path.join(directory,p.file),'utf8');if(createHash('sha256').update(text).digest('hex')!==p.sha256)throw Error('capture_hash_mismatch');
  const b=JSON.parse(text),d=b.data;
  if(b.status!==true||String(b.errorCode)!=='0'||!d?.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'")||d.pageNo!==i+1||!Array.isArray(d.rows)||d.rows.length!==p.rows||d.lastPage!==(i===manifest.pages.length-1))throw Error('invalid_capture_page');
  total??=d.totalCount;if(total!==d.totalCount)throw Error('capture_total_changed');
  for(const r of d.rows){
   if(typeof r.id!=='string'||!/^[1-9]\d*$/.test(r.id)||seen.has(r.id)||!r.billno||!Object.hasOwn(r,'hzkj_delivery_status')||!Object.hasOwn(r,'hzkj_orders_billentry')||(r.hzkj_orders_billentry!==null&&!Array.isArray(r.hzkj_orders_billentry)))throw Error('outbound_capture_incomplete');
   for(const line of r.hzkj_orders_billentry??[])for(const key of ['hzkj_outbound_status','hzkj_outbound_qty'])if(!Object.hasOwn(line,key))throw Error('outbound_line_field_missing');
   seen.add(r.id);rows.push(r);
  }
 }
 if(total!==rows.length||manifest.rowCount!==rows.length)throw Error('capture_count_mismatch');
 return {manifest,rows};
}
const stripRaw=raw=>{const {hzkj_delivery_status,hzkj_orders_billentry,...rest}=raw;return {...rest,hzkj_orders_billentry:(hzkj_orders_billentry??[]).map(l=>{const {hzkj_outbound_qty,hzkj_outbound_status,...rest}=l;return rest})}};
// A field-only backfill must not re-evaluate unchanged normal orders merely
// because previously absent line facts or capture provenance were persisted.
function unchangedExceptionInputs(prior,next){
 const exclusions=d=>(d.businessStatus?.lines??[]).map(l=>[l.id,l.excluded]);
 const issues=d=>(d.nativeAssociationIssues??[]).filter(v=>v!=='current_source_outbound_status_unknown');
 return !prior.is_exception&&prior.raw_delivery_status===next.raw_delivery_status
  &&prior.display.businessStatus?.outbound===next.display.businessStatus?.outbound
  &&isDeepStrictEqual(prior.display.exception,next.display.exception)
  &&isDeepStrictEqual(exclusions(prior.display),exclusions(next.display))
  &&isDeepStrictEqual(issues(prior.display),issues(next.display))
  &&isDeepStrictEqual(prior.display.nativeProcurementAssociationIssues,next.display.nativeProcurementAssociationIssues);
}
async function repair(client,capture,{apply=false,backupFile,automaticCallsEnabled=false,lockTimeoutMs=55000}={}){
 if(!Number.isInteger(lockTimeoutMs)||lockTimeoutMs<1||lockTimeoutMs>900000)throw Error('invalid_repair_lock_timeout');
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});
 const {supplementOutboundLineFacts}=require('../backend/src/modules/fop-data/collected-outbound-supplement');
 const {rebuildCollectedChain}=require('../backend/src/modules/workbench-replica/collected-chain-storage');
 const db={query:async(sql,params)=>(await client.query(sql,params)).rows},report={apply,capturedAt:capture.manifest.capturedAt,captureRows:capture.rows.length,matched:0,changed:0,lines:0,progressChanged:0,missingLocal:0,conflicts:[],fopRequests:0,automaticCallsEnabled,configurationChanged:false};
 await db.query(apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const batches=(await db.query("SELECT to_jsonb(b) record FROM hz_fop_collected_batches b WHERE state='active'")).map(r=>r.record);
  if(batches.length!==1||batches[0].company_id!=='100000'||batches[0].tenant_id!=='hyperzone.test')throw Error('batch_scope_mismatch');let batch=batches[0];
  if(apply){
   // Match the sync worker's lock order: scope first, batch row second.
   await db.query("SELECT set_config('lock_timeout',$1,true)",[String(lockTimeoutMs)]);
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['timestamp:'+batch.id]);
   const [locked]=await db.query("SELECT to_jsonb(b) record FROM hz_fop_collected_batches b WHERE id=$1 AND state='active' FOR UPDATE",[batch.id]);
   if(!locked||locked.record.company_id!=='100000'||locked.record.tenant_id!=='hyperzone.test')throw Error('batch_scope_changed');batch=locked.record;
  }
  const stats=async()=>({outbound:await db.query("SELECT display->'businessStatus'->>'outbound' status,count(*)::int count FROM hz_fop_collected_orders WHERE batch_id=$1 GROUP BY 1 ORDER BY 1",[batch.id]),exceptions:await db.query("SELECT exception_type,count(*)::int count FROM hz_fop_collected_orders WHERE batch_id=$1 AND is_exception GROUP BY 1 ORDER BY 1",[batch.id])});
  report.before=await stats();
  if(apply){
   if(!backupFile)throw Error('backup_required');fs.writeFileSync(backupFile,JSON.stringify({batch})+'\n',{flag:'wx',mode:0o600});
   await db.query('CREATE TEMP TABLE outbound_lines_restore_check (LIKE hz_fop_collected_orders INCLUDING DEFAULTS) ON COMMIT DROP');
  }
  const hash=createHash('sha256');if(apply)hash.update(fs.readFileSync(backupFile));
  for(let i=0;i<capture.rows.length;i+=250){
   // JSON from PostgreSQL preserves microsecond timestamps for exact backup restoration.
   const incoming=capture.rows.slice(i,i+250),previous=(await db.query('SELECT to_jsonb(o) record FROM hz_fop_collected_orders o WHERE batch_id=$1 AND source_id=ANY($2::text[])'+(apply?' FOR UPDATE':''),[batch.id,incoming.map(s=>s.id)])).map(r=>r.record),byId=new Map(previous.map(r=>[r.source_id,r])),updates=[];
   const unchangedExceptionIds=[];
   for(const source of incoming){
    const prior=byId.get(source.id);if(!prior){report.missingLocal++;continue}report.matched++;
    let next;try{next=supplementOutboundLineFacts(prior,source,{companyId:'100000',capturedAt:capture.manifest.capturedAt})}catch(e){report.conflicts.push({orderNumber:source.billno,reason:e.message});continue}
    if(!isDeepStrictEqual(stripRaw(next.raw),stripRaw(prior.raw)))throw Error('unrelated_source_facts_changed');
    report.lines+=(source.hzkj_orders_billentry??[]).length;
    if(prior.display.businessStatus?.outbound!==next.display.businessStatus?.outbound)report.progressChanged++;
    if(isDeepStrictEqual(prior.raw,next.raw)&&isDeepStrictEqual(prior.display,next.display)&&prior.raw_delivery_status===next.raw_delivery_status)continue;
    report.changed++;updates.push({id:source.id,raw:next.raw,display:next.display,status:next.raw_delivery_status});
    if(unchangedExceptionInputs(prior,next))unchangedExceptionIds.push(source.id);
   }
   if(apply&&updates.length){
    const ids=new Set(updates.map(u=>u.id)),text=JSON.stringify(previous.filter(r=>ids.has(r.source_id)));fs.appendFileSync(backupFile,text+'\n');hash.update(text+'\n');
    await db.query('INSERT INTO outbound_lines_restore_check SELECT * FROM jsonb_populate_recordset(NULL::hz_fop_collected_orders,$1::jsonb)',[text]);
    const [{differences}]=await db.query('SELECT count(*)::int differences FROM hz_fop_collected_orders o JOIN outbound_lines_restore_check b USING(batch_id,source_id) WHERE o.source_id=ANY($1::text[]) AND to_jsonb(o) IS DISTINCT FROM to_jsonb(b)',[[...ids]]);if(differences)throw Error('backup_restore_mismatch');
    const existing=(await db.query("SELECT source_id FROM hz_fop_exception_dirty WHERE batch_id=$1 AND transaction_id=txid_current() AND document_kind='order' AND source_id=ANY($2::text[])",[batch.id,unchangedExceptionIds])).map(r=>r.source_id);
    await db.query('UPDATE hz_fop_collected_orders o SET raw=x.raw,display=x.display,raw_delivery_status=x.status FROM jsonb_to_recordset($2::jsonb) x(id text,raw jsonb,display jsonb,status text) WHERE o.batch_id=$1 AND o.source_id=x.id',[batch.id,JSON.stringify(updates)]);
    await db.query("DELETE FROM hz_fop_exception_dirty WHERE batch_id=$1 AND transaction_id=txid_current() AND document_kind='order' AND source_id=ANY($2::text[]) AND NOT(source_id=ANY($3::text[]))",[batch.id,unchangedExceptionIds,existing]);
   }
   if(i%5000===0)console.log(JSON.stringify({processed:report.matched,changed:report.changed,conflicts:report.conflicts.length}));
  }
  if(report.missingLocal||report.conflicts.length)throw Error('outbound_source_conflicts_require_full_document_sync');
  const [{total}]=await db.query('SELECT count(*)::int total FROM hz_fop_collected_orders WHERE batch_id=$1',[batch.id]);report.notReturnedBySource=total-report.matched;
  if(apply&&report.changed){
   const verified=createHash('sha256');for await(const chunk of fs.createReadStream(backupFile))verified.update(chunk);
   report.backupSha256=verified.digest('hex');if(report.backupSha256!==hash.digest('hex'))throw Error('backup_readback_failed');
   report.backupRestoreVerified=true;
   await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||jsonb_build_object('fulfillment_outbound_lines',$2::jsonb)) WHERE id=$1",[batch.id,JSON.stringify({capturedAt:report.capturedAt,companyId:'100000',coverage:'full_company_scan',fields:['hzkj_orders_billentry.hzkj_outbound_status','hzkj_orders_billentry.hzkj_outbound_qty'],matched:report.matched,lineCount:report.lines,consistentSnapshot:false})]);
   console.log('Rebuilding local source graph');report.graph=await rebuildCollectedChain(db,batch.id);
   console.log('Recalculating affected exception projections');await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  }
  report.after=await stats();await db.query(apply?'COMMIT':'ROLLBACK');report.committed=apply;return report;
 }catch(error){await db.query('ROLLBACK');error.report={...report,committed:false,error:error.message};throw error}
}
module.exports={collect,repair,unchangedExceptionInputs};
if(require.main===module)(async()=>{
 const [mode,directory,reportPath,serialization]=process.argv.slice(2);if(!['--dry-run','--apply'].includes(mode)||!directory||!reportPath||serialization&&serialization!=='--serialize-with-sync')throw Error('explicit_mode_capture_report_required');
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'));
 if(e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='55432'||e.DB_DATABASE!=='autoflow_local_demo')throw Error('local_database_required');
 if(serialization!=='--serialize-with-sync'&&(e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false'))throw Error('paused_local_database_required');
 const {Client}=require('pg'),client=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await client.connect();
 try{const report=await repair(client,collect(directory),{apply:mode==='--apply',automaticCallsEnabled:e.WORKBENCH_AUTOMATIC_CALLS_ENABLED==='true',backupFile:path.join(path.dirname(reportPath),'before-outbound-lines-'+Date.now()+'.jsonl')});fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))}
 catch(error){fs.writeFileSync(reportPath,JSON.stringify(error.report??{error:error.message},null,2),{mode:0o600});throw error}finally{await client.end()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
