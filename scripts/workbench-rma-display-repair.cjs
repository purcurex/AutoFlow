// Offline native RMA projection. Defaults to rollback; --apply requires a verified backup.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util'),{createHash}=require('node:crypto'),{Client}=require('pg');
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});
const {withCollectedRmaDetails}=require('../backend/src/modules/fop-data/collected-rma');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
async function repair(db,{apply=false,backupFile}={}){
 await db.query('BEGIN');try{
  const batches=(await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")).rows;
  if(batches.length!==1||!batches[0].metadata?.entityCaptures?.rma)throw Error('unique_active_rma_batch_required');const b=batches[0];
  const rows=(await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='rma' ORDER BY source_id FOR UPDATE",[b.id])).rows;
  const snapshot=JSON.stringify({batchId:b.id,metadata:b.metadata,rows});
  if(apply){if(!backupFile)throw Error('backup_required');fs.mkdirSync(path.dirname(backupFile),{recursive:true,mode:0o700});fs.writeFileSync(backupFile,snapshot,{mode:0o600,flag:'wx'});if(fs.readFileSync(backupFile,'utf8')!==snapshot)throw Error('backup_readback_failed');}
  // Restore the backup rows into an isolated temporary table and compare every field.
  await db.query('CREATE TEMP TABLE rma_repair_restore_check (LIKE hz_fop_collected_entities INCLUDING DEFAULTS) ON COMMIT DROP');
  await db.query("INSERT INTO rma_repair_restore_check SELECT * FROM jsonb_populate_recordset(NULL::hz_fop_collected_entities,$1::jsonb)",[JSON.stringify(JSON.parse(snapshot).rows)]);
  const [{differences}]=(await db.query("SELECT count(*)::int differences FROM ((SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='rma' EXCEPT SELECT * FROM rma_repair_restore_check) UNION ALL (SELECT * FROM rma_repair_restore_check EXCEPT SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='rma')) diff",[b.id])).rows;
  if(differences)throw Error('backup_restore_mismatch');
  let updated=0;const displays=[];
  for(const row of rows){
   if(row.source_id!==row.raw?.case?.id||row.display.id!==row.source_id)throw Error('rma_source_identity_mismatch');
   const d=withCollectedRmaDetails(row.display,row.raw.case);displays.push(d);
   const search=[d.orderNumber,d.shopifyOrderNumber,d.customerName,d.storeName,d.owner?.name,...d.items.flatMap(i=>[i.sku,i.name]),...(d.rmaCases??[]).flatMap(c=>[c.number,c.stage,c.reason])].filter(Boolean).join(' ').toLowerCase();
   if(equal(d,row.display)&&search===row.search_text)continue;
   await db.query("UPDATE hz_fop_collected_entities SET display=$3,search_text=$4 WHERE batch_id=$1 AND entity_type='rma' AND source_id=$2",[b.id,row.source_id,JSON.stringify(d),search]);updated++;
  }
  const counts={rowCount:rows.length,exceptionCount:displays.filter(d=>d.rmaAssociation?.state!=='verified').length,quarantineCount:displays.filter(d=>d.rmaAssociation?.companyVerified!==true).length};
  const capture=b.metadata.entityCaptures.rma,next={...capture,...counts,displayProjectionVersion:2};
  const metadataChanged=!equal(capture,next);
  if(metadataChanged||updated)await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures,rma}',$2::jsonb) WHERE id=$1",[b.id,JSON.stringify(next)]);
  const [{changed_source}]=(await db.query("SELECT count(*)::int changed_source FROM hz_fop_collected_entities e JOIN rma_repair_restore_check r USING(batch_id,entity_type,source_id) WHERE e.raw IS DISTINCT FROM r.raw OR e.owner_employee_id IS DISTINCT FROM r.owner_employee_id OR e.captured_at IS DISTINCT FROM r.captured_at",[])).rows;
  if(changed_source)throw Error('source_or_scope_changed');
  const result={apply,...counts,updated,metadataChanged,backupRestoreVerified:true,rawUnchanged:true,sourceCapturedAt:capture.capturedAt,upstreamCalled:false,backupSha256:apply?createHash('sha256').update(snapshot).digest('hex'):undefined};
  await db.query(apply?'COMMIT':'ROLLBACK');return result;
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={repair};
if(require.main===module)(async()=>{
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'));
 if(e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='55432'||e.DB_DATABASE!=='autoflow_local_demo'||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false')throw Error('local_paused_database_required');
 const apply=process.argv.includes('--apply'),backupFile=apply?`.runtime/sales-quality-repair/rma-before-${Date.now()}.json`:undefined;
 const db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect();try{console.log(JSON.stringify(await repair(db,{apply,backupFile})))}finally{await db.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
