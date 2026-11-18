// Import only captured SKU catalogue attributes, never infer document/entry relations from SKU.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{parseEnv}=require('node:util')
function collect(directories,target='hzkj_sku_value'){
 if(!['hzkj_sku_value','name'].includes(target))throw Error('invalid_catalogue_field')
 const products=new Map(),conflicts=new Set();let orders=0,lines=0,missing=0
 for(const dir of directories){
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
  if(!m.complete||m.companyId!=='100000'||m.context?.tenantId!=='hyperzone.test'||!['fulfillment','stock'].includes(m.entityType)||m.coverage!=='full_company_scan')throw Error('invalid_capture')
  const seen=new Set()
  for(const page of m.pages){
   const raw=fs.readFileSync(path.join(dir,page.file),'utf8')
   if(createHash('sha256').update(raw).digest('hex')!==page.sha256)throw Error('capture_hash_mismatch')
   const body=JSON.parse(raw);if(body.status!==true||!body.data?.filter?.includes('org in (100000)'))throw Error('invalid_scope')
   for(const row of body.data.rows){
    if(seen.has(row.id))throw Error('duplicate_order');seen.add(row.id);orders++
    for(const e of row.hzkj_orders_billentry??[]){
     lines++
     const id=e.hzkj_local_sku_id,sku=e.hzkj_local_sku_number,field=target==='name'?'hzkj_local_sku_name':'hzkj_local_sku_hzkj_sku_value'
     if(!/^[1-9]\d*$/.test(id??'')||typeof sku!=='string'||!sku.trim()||!Object.hasOwn(e,field)){missing++;continue}
     if(e[field]!==null&&typeof e[field]!=='string')throw Error('invalid_attribute')
     const value={id,number:sku,[target]:e[field],attributeCapture:{capturedAt:m.capturedAt,sourceEntity:m.entityType,documentId:row.id,entryId:e.id,field}}
     const old=products.get(id)
     if(old&&(old.number!==sku||old[target]!==e[field]))conflicts.add(id)
     products.set(id,value)
    }
   }
  }
  if(seen.size!==m.rowCount)throw Error('incomplete_capture')
 }
 for(const id of conflicts)products.delete(id)
 return {products:[...products.values()],orders,lines,missing,conflicts:[...conflicts]}
}
async function main(){
 const args=process.argv.slice(2),target=args.includes('--picking-name')?'name':'hzkj_sku_value',dirs=args.filter(x=>x!=='--picking-name');if(!dirs.length)throw Error('capture_paths_required')
 const result=collect(dirs,target),e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(e.DB_DATABASE!=='autoflow_local_demo'||e.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(e.DB_HOST))throw Error('local_db_required')
 const {Client}=require('pg'),db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect()
 const backup='.runtime/sku-attributes-backup-'+Date.now()+'.json'
 try{
  await db.query('BEGIN')
  const {rows:b}=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")
  if(b.length!==1||b[0].company_id!=='100000'||b[0].tenant_id!=='hyperzone.test')throw Error('batch_mismatch')
  const batch=b[0],ids=result.products.map(x=>x.id)
  const old=await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='product' AND source_id=ANY($2::text[])",[batch.id,ids])
  for(const row of old.rows){const incoming=result.products.find(p=>p.id===row.source_id);if(row.raw.number!==incoming.number)throw Error('catalogue_identity_mismatch')}
  fs.writeFileSync(backup,JSON.stringify({batchId:batch.id,metadata:batch.metadata,rows:old.rows,newIds:ids.filter(id=>!old.rows.some(x=>x.source_id===id))}),{mode:0o600,flag:'wx'})
  for(let i=0;i<result.products.length;i+=250){
   const rows=result.products.slice(i,i+250)
   await db.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at)
   SELECT $1,'product',x->>'id','{}'::jsonb,x,lower(x->>'number'),(x->'attributeCapture'->>'capturedAt')::timestamptz FROM jsonb_array_elements($2::jsonb) x
   ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=hz_fop_collected_entities.raw||(EXCLUDED.raw-'id'-'number')
   WHERE hz_fop_collected_entities.raw->>'number'=EXCLUDED.raw->>'number'
   AND coalesce(hz_fop_collected_entities.raw->'attributeCapture'->>'capturedAt','')<=EXCLUDED.raw->'attributeCapture'->>'capturedAt'`,[batch.id,JSON.stringify(rows)])
  }
  const report={orders:result.orders,lines:result.lines,products:ids.length,empty:result.products.filter(x=>!x[target]?.trim()).length,missing:result.missing,conflicts:result.conflicts.length,capturedAt:new Date().toISOString(),backup,sourceField:target==='name'?'hzkj_local_sku_name':'hzkj_local_sku_hzkj_sku_value',consistentSnapshot:false}
  await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||jsonb_build_object($3::text,$2::jsonb)) WHERE id=$1",[batch.id,JSON.stringify(report),target==='name'?'sku_picking_names':'sku_attributes'])
  await db.query('COMMIT');fs.writeFileSync(backup+'.report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
}
module.exports={collect};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1})
