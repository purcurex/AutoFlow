// Preserve supplied refund facts independently. Never admit candidates as physical returns.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{parseEnv}=require('node:util')
function readCapture(dir){
 const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
 const types={queryPurchaseReturn:['hzkj_purorderbill','purchase_refund_candidate'],queryPurchaseRefundApplication:['hzkj_purrefundapplybill','purchase_refund_application']},type=types[m.operation]
 if(!type||!m.complete||m.physicalReturnIntegration!==false||m.companyId!=='100000'||m.orgNumber!=='hyperzone.test'||m.context?.tenantId!=='hyperzone.test'||m.sourceEntity!==type[0])throw Error('invalid_capture')
 const seen=new Set(),rows=[]
 for(const [index,page] of m.pages.entries()){
  if(path.basename(page.file)!==page.file)throw Error('invalid_page_path')
  const raw=fs.readFileSync(path.join(dir,page.file),'utf8')
  if(createHash('sha256').update(raw).digest('hex')!==page.sha256)throw Error('capture_hash_mismatch')
  const b=JSON.parse(raw),d=b.data
  if(b.status!==true||!d?.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'")||d.pageNo!==index+1||!Array.isArray(d.rows)||d.totalCount!==m.rowCount||d.lastPage!==(index===m.pages.length-1))throw Error('invalid_scope_or_page')
  for(const r of d.rows){if(typeof r.id!=='string'||!/^[1-9]\d*$/.test(r.id)||seen.has(r.id))throw Error('invalid_source_id');seen.add(r.id);rows.push(r)}
 }
 if(!m.pages.length||rows.length!==m.rowCount)throw Error('incomplete_capture')
 return {manifest:m,entityType:type[1],rows}
}
async function main(){
 const captures=process.argv.slice(2).map(readCapture)
 if(!captures.length||new Set(captures.map(x=>x.entityType)).size!==captures.length)throw Error('distinct_captures_required')
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(env.DB_DATABASE!=='autoflow_local_demo'||env.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(env.DB_HOST))throw Error('local_database_required')
 const {Client}=require('pg'),db=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});await db.connect()
 try{
  await db.query('BEGIN');const {rows:b}=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")
  if(b.length!==1||b[0].company_id!=='100000'||b[0].tenant_id!=='hyperzone.test')throw Error('batch_mismatch')
  const batch=b[0],types=captures.map(x=>x.entityType),old=await db.query('SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type=ANY($2::text[])',[batch.id,types])
  const backup=`.runtime/purchase-refund-backup-${Date.now()}.json`;fs.writeFileSync(backup,JSON.stringify({batchId:batch.id,metadata:batch.metadata,rows:old.rows}),{mode:0o600,flag:'wx'})
  const evidence={}
  for(const c of captures){
   // No deletion: a scan of changing source data is not an authoritative deletion event.
   for(const raw of c.rows)await db.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=EXCLUDED.raw,display=EXCLUDED.display,search_text=EXCLUDED.search_text,captured_at=EXCLUDED.captured_at
    WHERE hz_fop_collected_entities.captured_at<=EXCLUDED.captured_at`,[batch.id,c.entityType,raw.id,JSON.stringify({sourceEntity:c.manifest.sourceEntity,physicalReturnIntegration:false}),JSON.stringify(raw),raw.billno?.toLowerCase()??'',c.manifest.capturedAt])
   evidence[c.entityType]={capturedAt:c.manifest.capturedAt,rows:c.rows.length,operation:c.manifest.operation,physicalReturnIntegration:false,complete:true}
  }
  await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[batch.id,JSON.stringify(evidence)])
  await db.query('COMMIT');console.log(JSON.stringify({stored:evidence,backup,physicalReturnIntegration:false}))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
}
module.exports={readCapture};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1})
