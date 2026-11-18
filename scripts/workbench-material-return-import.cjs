const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{parseEnv}=require('node:util')
const {linkReturnPurchases}=require('./material-return-purchase-links.cjs')
const {normalizeMaterialReturn}=require('./purchase-material-return-facts.cjs')
async function main(){
 const dir=process.argv[2],apply=process.argv.includes('--apply'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
 if(!m.complete||m.companyId!=='100000'||m.tenantId!=='hyperzone.test')throw Error('invalid_capture')
 const rows=m.files.map(p=>{if(path.basename(p.file)!==p.file)throw Error('invalid_path');const s=fs.readFileSync(path.join(dir,p.file),'utf8');if(createHash('sha256').update(s).digest('hex')!==p.sha256)throw Error('invalid_hash');const raw=JSON.parse(s);return{raw,display:normalizeMaterialReturn(raw.directory,raw.detail)}}).filter(r=>r.display)
 if(new Set(rows.map(r=>r.display.id)).size!==rows.length)throw Error('duplicate_id')
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(env.DB_DATABASE!=='autoflow_local_demo'||env.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(env.DB_HOST))throw Error('local_only')
 const {Client}=require('pg'),db=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});await db.connect()
 try{
 await db.query('BEGIN');const {rows:b}=await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")
 if(b.length!==1||b[0].company_id!==m.companyId||b[0].tenant_id!==m.tenantId)throw Error('batch_mismatch')
 const batch=b[0]
 const purchases=(await db.query("SELECT raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase'",[batch.id])).rows.map(r=>r.raw)
 for(const r of rows)r.display=linkReturnPurchases(r.display,purchases,m.companyId)
 const old=await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase_material_return'",[batch.id])
 if(apply)fs.writeFileSync(`.runtime/material-return-backup-${Date.now()}.json`,JSON.stringify({metadata:batch.metadata,rows:old.rows}),{mode:0o600,flag:'wx'})
 for(const r of rows)await db.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase_material_return',$2,$3,$4,$5,$6) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET display=EXCLUDED.display,raw=EXCLUDED.raw,search_text=EXCLUDED.search_text,captured_at=EXCLUDED.captured_at WHERE hz_fop_collected_entities.captured_at<=EXCLUDED.captured_at`,[batch.id,r.display.id,JSON.stringify(r.display),JSON.stringify(r.raw),[r.display.number,r.display.supplier.name,...r.display.lines.flatMap(l=>[l.orderNumber,l.sku,l.name])].join(' ').toLowerCase(),m.capturedAt])
 const [quality]= (await db.query(`WITH lines AS (SELECT e.source_id,l->>'orderNumber' number FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='purchase_material_return') SELECT count(*)::int lines,count(*) FILTER(WHERE number IS NULL)::int missing_order_number,count(*) FILTER(WHERE number IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_orders o WHERE o.batch_id=$1 AND o.order_number=lines.number))::int unmatched_order_number FROM lines`,[batch.id])).rows
 const evidence={companyId:m.companyId,capturedAt:m.capturedAt,rows:rows.length,coverage:m.coverage,sourceScanComplete:m.coverage==='all-material-return-api-pages'&&m.complete,sourceApiRows:m.apiRows??null,complete:false,source:'queryPurchaseMaterialReturn',quality}
 await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[batch.id,JSON.stringify({purchase_material_return:evidence})])
 await db.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify({applied:apply,...evidence}))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
