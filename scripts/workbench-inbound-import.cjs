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
   if(typeof row.id!=='string'||!/^[1-9]\d*$/.test(row.id)||seen.has(row.id)||!row.billno||!Object.hasOwn(row,'hzkj_purchase_status'))throw Error('inbound_capture_incomplete')
   if(!Object.hasOwn(row,'hzkj_orders_billentry')||(row.hzkj_orders_billentry!==null&&!Array.isArray(row.hzkj_orders_billentry)))throw Error('inbound_entries_missing')
   for(const line of row.hzkj_orders_billentry??[])for(const key of ['hzkj_entrypurc_status','hzkj_purcqty','hzkj_instock_qty'])if(!Object.hasOwn(line,key))throw Error('inbound_field_missing_'+key)
   seen.add(row.id);states[row.hzkj_purchase_status||'unknown']=(states[row.hzkj_purchase_status||'unknown']||0)+1
   rows.push(row)
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
 if(mode==='--rehearsal'&&!/^hz_inbound_restore_\d+$/.test(backup.restoreDatabase))throw Error('rehearsal_database_required')
 require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
 const {supplementInboundFacts}=require('../backend/src/modules/fop-data/collected-inbound-supplement'),{Client}=require('pg')
 const db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:mode==='--rehearsal'?backup.restoreDatabase:e.DB_DATABASE});await db.connect()
 const factsHash=async()=> (await db.query(`SELECT count(*)::int total,md5(string_agg(md5((raw-ARRAY['hzkj_purchase_status','hzkj_purchase_status_title','hzkj_orders_billentry'])::text||coalesce((SELECT jsonb_agg(line-ARRAY['hzkj_entrypurc_status','hzkj_purcqty','hzkj_instock_qty'] ORDER BY line->>'id') FROM jsonb_array_elements(raw->'hzkj_orders_billentry') line),'[]'::jsonb)::text||(display-ARRAY['sourcePurchaseStatus','inboundCapture'])::text),'' ORDER BY source_id)) other_facts_hash FROM hz_fop_collected_orders WHERE batch_id=$1`,[batch.id])).rows[0]
 let batch;const report={capturedAt:capture.manifest.capturedAt,captureRows:capture.rows.length,states:capture.states,mode,matched:0,changed:0,missingLocal:0,conflicts:[],automaticCallsEnabled:false,upstreamCalled:false,consistentSnapshot:false}
 try{
  await db.query('BEGIN');const b=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")
  if(b.rows.length!==1||b.rows[0].company_id!=='100000'||b.rows[0].tenant_id!=='hyperzone.test')throw Error('batch_scope_mismatch');batch=b.rows[0]
  report.before=await factsHash()
  if(mode!=='--dry-run'){
   const current=(await db.query("SELECT count(*)::int n,md5(string_agg(md5(raw::text||display::text||coalesce(raw_delivery_status,'')),'' ORDER BY batch_id,source_id)) hash FROM hz_fop_collected_orders")).rows[0]
   if(!isDeepStrictEqual(current,backup.original))throw Error('backup_not_current')
  }
  for(let i=0;i<capture.rows.length;i+=250){
   const source=capture.rows.slice(i,i+250),stored=await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) FOR UPDATE',[batch.id,source.map(s=>s.id)]),map=new Map(stored.rows.map(r=>[r.source_id,r])),patches=[]
   for(const s of source){const prior=map.get(s.id);if(!prior){report.missingLocal++;continue}report.matched++
    let next;try{next=supplementInboundFacts(prior,s,{companyId:'100000',capturedAt:capture.manifest.capturedAt})}catch(e){report.conflicts.push({orderNumber:s.billno,reason:e.message});continue}
    const keys=['sourcePurchaseStatus','inboundCapture'],patch=Object.fromEntries(keys.map(k=>[k,next.display[k]]))
    if(isDeepStrictEqual(prior.raw,next.raw)&&keys.every(k=>isDeepStrictEqual(prior.display[k],next.display[k])))continue
    report.changed++;patches.push({id:s.id,raw:next.raw,display:patch})
   }
   if(patches.length)await db.query(`UPDATE hz_fop_collected_orders o SET raw=x->'raw',display=o.display||(x->'display') FROM jsonb_array_elements($2::jsonb) x WHERE o.batch_id=$1 AND o.source_id=x->>'id'`,[batch.id,JSON.stringify(patches)])
  }
  report.after=await factsHash();if(report.before.total!==report.after.total||report.before.other_facts_hash!==report.after.other_facts_hash)throw Error('unrelated_facts_changed')
  if(report.missingLocal)throw Error('inbound_new_orders_require_full_import')
  if(report.conflicts.length)throw Error('inbound_source_conflicts')
  report.notReturnedBySource=report.before.total-report.matched

  if(mode!=='--dry-run')await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||jsonb_build_object('fulfillment_inbound',$2::jsonb)) WHERE id=$1",[batch.id,JSON.stringify({capturedAt:capture.manifest.capturedAt,companyId:'100000',coverage:'full_company_scan',fields:['hzkj_purchase_status','hzkj_purchase_status_title','hzkj_orders_billentry.hzkj_entrypurc_status','hzkj_orders_billentry.hzkj_purcqty','hzkj_orders_billentry.hzkj_instock_qty'],matched:report.matched,sourceRows:report.captureRows,consistentSnapshot:false})])
  await db.query(mode==='--dry-run'?'ROLLBACK':'COMMIT');report.committed=mode!=='--dry-run'
 }catch(e){await db.query('ROLLBACK');report.committed=false;report.error=e.message;process.exitCode=1}finally{await db.end()}
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({...report,conflicts:report.conflicts.slice(0,5),conflictCount:report.conflicts.length}))
}
module.exports={collect};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1})
