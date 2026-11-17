// Offline transaction: backup and restore-check, preserve raw decimals, then upsert dispatch analytics only.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util'),{createHash}=require('node:crypto')
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});require('reflect-metadata')
const {normalizeCollectedAnalyticsFact}=require('../backend/src/modules/fop-data/collected-analytics-facts')
const {buildReplicaOrganization}=require('../backend/src/modules/workbench-replica/local-workbench-organization')
const {collectedOrganizationQuery}=require('../backend/src/modules/workbench-replica/collected-organization-query')
const shouldApplyDispatchSql="coalesce((hz_fop_collected_analytics_facts.facts#>>'{dates,updatedAt,value}')::timestamptz,'-infinity'::timestamptz)<=(excluded.facts#>>'{dates,updatedAt,value}')::timestamptz"
async function main(){
 const dir=process.argv[2];if(!dir)throw Error('capture_required')
 const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),cfg=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'))
 if(env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_SYNC_ENABLED!=='false'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||env.DB_HOST!=='127.0.0.1'||env.DB_DATABASE!=='autoflow_local_demo')throw Error('local_paused_database_required')
 if(!m.complete||m.version!==2||m.companyId!=='100000'||m.context.tenantId!==cfg.FOP_KINGDEE_TENANT_ID||m.context.userId!==cfg.FOP_KINGDEE_USER_ID||!m.pages.length)throw Error('invalid_capture')
 const {Client}=require('pg'),db=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});await db.connect()
 try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='10s'")
 const batches=(await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' AND company_id=$1 AND tenant_id=$2 FOR UPDATE",[m.companyId,m.context.tenantId])).rows
 if(batches.length!==1)throw Error('active_batch_required');const b=batches[0]
 // Raw SQL JSON text avoids a round trip through JavaScript floating point.
 const before=(await db.query("SELECT row_to_json(f)::text AS row FROM hz_fop_collected_analytics_facts f WHERE batch_id=$1 AND entity_type='dispatch'",[b.id])).rows
 const backupSuffix=Date.now(),backup=path.join(dir,`before-dispatch-${backupSuffix}.ndjson`);fs.writeFileSync(backup,before.map(r=>r.row).join('\n')+'\n',{mode:0o600,flag:'wx'})
 fs.writeFileSync(path.join(dir,`before-batch-${backupSuffix}.json`),JSON.stringify(b),{mode:0o600,flag:'wx'})
 await db.query('CREATE TEMP TABLE freight_restore_check (LIKE hz_fop_collected_analytics_facts INCLUDING ALL) ON COMMIT DROP')
 for(let i=0;i<before.length;i+=100)await db.query('INSERT INTO freight_restore_check SELECT * FROM jsonb_populate_recordset(NULL::hz_fop_collected_analytics_facts,$1::jsonb)',['['+before.slice(i,i+100).map(r=>r.row).join(',')+']'])
 const restored=(await db.query("SELECT count(*)::int n FROM ((SELECT * FROM freight_restore_check EXCEPT SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type='dispatch') UNION ALL (SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type='dispatch' EXCEPT SELECT * FROM freight_restore_check)) differences",[b.id])).rows[0]
 if(restored.n!==0)throw Error('backup_restore_mismatch')
 await db.query('CREATE TEMP TABLE freight_capture (id text PRIMARY KEY, raw jsonb NOT NULL) ON COMMIT DROP')
 for(const p of m.pages){const raw=fs.readFileSync(path.join(dir,p.file),'utf8');if(createHash('sha256').update(raw).digest('hex')!==p.sha256)throw Error('capture_hash_mismatch')
  const d=JSON.parse(raw).data;if(!d.lastPage||d.rows.length!==d.totalCount||d.rows.some(r=>r.org_id!==m.companyId||typeof r.id!=='string'||!Object.hasOwn(r,'hzkj_bizoperator_id')||!Object.hasOwn(r,'hzkj_sale_org_id')))throw Error('invalid_source_row')
  await db.query(`INSERT INTO freight_capture SELECT x->>'id',x FROM jsonb_array_elements($1::jsonb->'data'->'rows') x ON CONFLICT(id) DO UPDATE SET raw=excluded.raw WHERE excluded.raw->>'modifytime'>=freight_capture.raw->>'modifytime'`,[raw])
 }
 const captured=(await db.query('SELECT count(*)::int n FROM freight_capture')).rows[0].n;if(captured!==m.rowCount)throw Error('capture_count_mismatch')
 const nodes=(await db.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[b.workspace_owner_id])).rows
 const employees=(await db.query(collectedOrganizationQuery,[b.workspace_owner_id,b.tenant_id,b.company_id])).rows
 const org=buildReplicaOrganization({id:b.workspace_owner_id,role:'admin',accountDisabled:false},b.workspace_owner_id,nodes,employees,{tenant_id:b.tenant_id,source_company_id:b.company_id})
 const members=new Map(org.members.map(e=>[e.employeeId,e]))
 const rows=(await db.query(`SELECT raw,raw->>'hzkj_actual_freight' actual,raw->>'hzkj_estimate_freight' estimate,raw->>'hzkj_freight_amount' freight,raw->>'hzkj_differe_freight' difference FROM freight_capture`)).rows
 let verified=0,positive=0,updatedRows=0
 for(let i=0;i<rows.length;i+=200){const values=rows.slice(i,i+200).map(r=>{
   const f=normalizeCollectedAnalyticsFact('dispatch',{...r.raw,hzkj_actual_freight:r.actual,hzkj_estimate_freight:r.estimate,hzkj_freight_amount:r.freight,hzkj_differe_freight:r.difference},{companyId:m.companyId,capturedAt:m.capturedAt,scopeVerified:true})
   const member=members.get(r.raw.hzkj_bizoperator_id);f.owner_employee_id=member?.employeeId??null;f.department_id=member?.departmentId??null
   f.facts.sourceOwnershipVerified=!!member;f.facts.effective=!!member&&f.facts.businessEligible
   if(member)f.facts.missingFields=f.facts.missingFields.filter(x=>x!=='verifiedOwnerEmployeeId')
   f.facts.association={state:member?'verified':'unresolved',basis:'native_dispatch_employee_master_id'}
   if(member)verified++;if(f.amount!==null&&Number(f.amount)>0)positive++
   if(!f.facts.dates.updatedAt)throw Error('invalid_source_modifytime')
   delete f.raw;return f
  })
  const applied=await db.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,owner_employee_id,customer_id,department_id,created_at,paid_at,source_paid_at,occurred_at,amount,currency_code,quantity,raw_status,facts,raw,captured_at)
   SELECT $1,x.entity_type,x.source_id,x.company_id,x.document_number,x.owner_employee_id,x.customer_id,x.department_id,x.created_at,x.paid_at,x.source_paid_at,x.occurred_at,x.amount,x.currency_code,x.quantity,x.raw_status,x.facts,c.raw,x.captured_at
   FROM jsonb_to_recordset($2::jsonb) x(entity_type text,source_id text,company_id text,document_number text,owner_employee_id text,customer_id text,department_id text,created_at timestamptz,paid_at timestamptz,source_paid_at timestamptz,occurred_at timestamptz,amount numeric,currency_code text,quantity numeric,raw_status text,facts jsonb,captured_at timestamptz) JOIN freight_capture c ON c.id=x.source_id
   ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET company_id=excluded.company_id,document_number=excluded.document_number,owner_employee_id=excluded.owner_employee_id,customer_id=excluded.customer_id,department_id=excluded.department_id,created_at=excluded.created_at,occurred_at=excluded.occurred_at,amount=excluded.amount,currency_code=excluded.currency_code,raw_status=excluded.raw_status,facts=excluded.facts,raw=excluded.raw,captured_at=excluded.captured_at
   WHERE ${shouldApplyDispatchSql}`,[b.id,JSON.stringify(values)])
  updatedRows+=applied.rowCount
 }
 const retained=(await db.query("SELECT count(*)::int n FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type='dispatch' AND source_id NOT IN(SELECT id FROM freight_capture)",[b.id])).rows[0].n
 const meta={...b.metadata?.analyticsCaptures?.dispatch,nativeOwnership:true,importedAt:new Date().toISOString(),capturedAt:m.capturedAt,companyId:m.companyId,coverage:'full_company_scan',consistentSnapshot:false,rowCount:captured,pageCount:m.pages.length,verifiedOwnerRows:verified,retainedAbsentRows:retained,captureId:createHash('sha256').update(JSON.stringify(m)).digest('hex')}
 await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{analyticsCaptures,dispatch}',$2::jsonb) WHERE id=$1",[b.id,JSON.stringify(meta)])
 await db.query('COMMIT')
 const report={imported:true,rows:captured,updatedRows,retainedNewerRows:captured-updatedRows,verifiedOwnerRows:verified,positiveAmountWithCurrency:positive,retainedAbsentRows:retained,backupRestoreVerified:true,sourceRawDecimalsPreserved:true,upstreamCalls:0,automaticCallsEnabled:false}
 fs.writeFileSync(path.join(dir,'import-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
}
module.exports={shouldApplyDispatchSql}
if(require.main===module)main().catch(e=>{console.error(/^[a-z_]+$/.test(e.message)?e.message:'freight_import_failed');process.exitCode=1})
