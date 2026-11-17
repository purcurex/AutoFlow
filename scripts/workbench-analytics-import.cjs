#!/usr/bin/env node
// Offline, transactional import of verified supplemental API captures. No network calls.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util'),{createHash}=require('node:crypto')
const analyticsShouldApplySql="coalesce((hz_fop_collected_analytics_facts.facts#>>'{dates,updatedAt,value}')::timestamptz,hz_fop_collected_analytics_facts.captured_at)<=coalesce((excluded.facts#>>'{dates,updatedAt,value}')::timestamptz,excluded.captured_at)"
const sha=s=>createHash('sha256').update(s).digest('hex')
function loadCapture(directory,expected){
 const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))
 const operations={fulfillment:'order-list',stock:'stock',purchase:'purchase',dispatch:'dispatch',receipt:'receipt'}
 if(!Object.hasOwn(operations,m.entityType)||m.operation!==operations[m.entityType])throw Error('capture_entity_operation_mismatch')
 if(m.version!==1||!m.complete||m.coverage!=='full_company_scan'||m.consistentSnapshot!==false||m.companyId!=='100000'||m.orgNumber!=='hyperzone.test'||m.context?.tenantId!==expected.FOP_KINGDEE_TENANT_ID||m.context?.userId!==expected.FOP_KINGDEE_USER_ID||!m.captureId||!Array.isArray(m.pages)||!m.pages.length||!/(Z|[+-]\d{2}:\d{2})$/.test(m.capturedAt)||!Number.isFinite(Date.parse(m.capturedAt)))throw Error('invalid_manifest')
 const rows=[],seen=new Set();let total
 for(let i=0;i<m.pages.length;i++){
  const p=m.pages[i];if(p.file!==`page-${String(i+1).padStart(4,'0')}.json`)throw Error('invalid_page_path')
  const raw=fs.readFileSync(path.join(directory,p.file),'utf8');if(sha(raw)!==p.sha256)throw Error('capture_hash_mismatch')
  const envelope=JSON.parse(raw),d=envelope.data
  if(envelope.status!==true||String(envelope.errorCode)!=='0'||d.pageNo!==i+1||d.lastPage!==(i===m.pages.length-1)||!d.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'")||!Array.isArray(d.rows)||d.rows.length!==p.rows||d.rows.length>d.pageSize)throw Error('invalid_page_proof')
  if(total!==undefined&&total!==d.totalCount)throw Error('unstable_capture');total=d.totalCount
  for(const r of d.rows){if(typeof r.id!=='string'||seen.has(r.id))throw Error('duplicate_id');seen.add(r.id);rows.push(r)}
 }
 if(total!==rows.length||m.rowCount!==rows.length)throw Error('capture_count_mismatch')
 return {manifest:m,rows}
}
function associate(row,byId,byNumber,stockById,verifiedEmployees=new Set()){
 if(row.entity_type==='dispatch'&&Object.hasOwn(row.raw,'hzkj_bizoperator_id')){
  const owner=row.raw.hzkj_bizoperator_id,verified=verifiedEmployees.has(owner)
  row.owner_employee_id=verified?owner:null
  row.facts.sourceOwnershipVerified=verified;row.facts.effective=verified&&row.facts.businessEligible===true
  if(verified)row.facts.missingFields=(row.facts.missingFields??[]).filter(x=>x!=='verifiedOwnerEmployeeId')
  row.facts.association={state:verified?'verified':'unresolved',basis:'native_dispatch_employee_master_id',sourceOrderIds:[],ownerEmployeeIds:verified?[owner]:[]}
  return row
 }
 let parents=[]
 if(row.entity_type==='fulfillment'){
  const p=byId.get(row.source_id);if(p&&p.order_number===row.document_number&&(!row.raw.hzkj_operator_id||row.raw.hzkj_operator_id===p.owner_employee_id))parents=[p]
 }else if(row.entity_type==='stock'){
  const p=stockById.get(row.source_id);if(p&&p.number===row.document_number&&(!row.raw.hzkj_operator_id||row.raw.hzkj_operator_id===p.owner_employee_id))parents=[p]
 }else if(row.entity_type==='dispatch'){
  const p=byNumber.get(row.raw.hzkj_order_no);if(p&&(!row.customer_id||row.customer_id===p.customer_id))parents=[p]
 }else if(row.entity_type==='purchase'){
  const refs=[...new Set((row.raw.hzkj_billentry??[]).map(l=>l.hzkj_salbillnumber).filter(Boolean))];if(refs.length&&refs.every(n=>byNumber.get(n)))parents=refs.map(n=>byNumber.get(n))
 }else if(row.entity_type==='receipt'){
  const refs=[...new Set([row.raw.hzkj_src_bill,...(row.raw.entryentity??[]).map(l=>l.hzkj_src_order)].filter(Boolean))];if(refs.length&&refs.every(n=>byNumber.get(n)))parents=refs.map(n=>byNumber.get(n))
 }
 const owners=[...new Set(parents.map(p=>p.owner_employee_id).filter(Boolean))]
 let verified=parents.length>0&&parents.every(p=>p.owner_employee_id)&&owners.length===1
 let basis='same_company_unique_local_source_document'
 if(!verified&&['fulfillment','stock'].includes(row.entity_type)&&!((row.entity_type==='fulfillment'?byId:stockById).has(row.source_id))&&verifiedEmployees.has(row.raw.hzkj_operator_id)){
  owners.splice(0,owners.length,row.raw.hzkj_operator_id);verified=true;basis='source_owner_matches_verified_local_employee_master_id'
 }
 row.owner_employee_id=verified?owners[0]:null
 row.facts.association={state:verified?'verified':'unresolved',basis,sourceOrderIds:parents.map(p=>p.source_id),ownerEmployeeIds:owners}
 row.facts.sourceOwnershipVerified=verified
 row.facts.effective=verified&&row.facts.businessEligible===true
 if(verified)row.facts.missingFields=(row.facts.missingFields??[]).filter(x=>x!=='verifiedOwnerEmployeeId')
 return row
}
async function main(){
 const args=process.argv.slice(2),dry=args.includes('--dry-run'),dirs=args.filter(x=>x!=='--dry-run');if(!dirs.length)throw Error('capture_directories_required')
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),fop=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'))
 if(env.DB_DATABASE!=='autoflow_local_demo'||env.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(env.DB_HOST)||env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||env.WORKBENCH_SYNC_ENABLED!=='false')throw Error('explicit_local_paused_target_required')
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});require('reflect-metadata')
 const {normalizeCollectedAnalyticsFact}=require('../backend/src/modules/fop-data/collected-analytics-facts')
 const captures=dirs.map(d=>loadCapture(d,fop));if(new Set(captures.map(c=>c.manifest.entityType)).size!==captures.length)throw Error('duplicate_family')
 for(const c of captures)c.normalized=c.rows.map(r=>normalizeCollectedAnalyticsFact(c.manifest.entityType,r,{companyId:c.manifest.companyId,capturedAt:c.manifest.capturedAt,scopeVerified:true}))
 if(dry){console.log(JSON.stringify(captures.map(c=>({entity:c.manifest.entityType,rows:c.normalized.length,amountWithCurrency:c.normalized.filter(r=>r.amount!==null&&r.currency_code!==null).length}))));return}
 const {DataSource}=require('typeorm'),db=new DataSource({type:'postgres',host:env.DB_HOST,port:+env.DB_PORT,username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,logging:false});await db.initialize()
 try{const result=await db.transaction(async q=>{
  const batches=await q.query("SELECT b.* FROM hz_fop_collected_batches b JOIN users u ON b.workspace_owner_id=coalesce(u.organization_workspace_owner_id,u.id) WHERE u.email='admin@hzdrop.com' AND b.state='active' AND b.company_id=$1 AND b.tenant_id=$2 FOR UPDATE",['100000',fop.FOP_KINGDEE_TENANT_ID]);if(batches.length!==1)throw Error('active_batch_required');const b=batches[0]
  const orders=await q.query('SELECT source_id,order_number,owner_employee_id,customer_id FROM hz_fop_collected_orders WHERE batch_id=$1',[b.id]),stock=await q.query("SELECT source_id,owner_employee_id,display->>'stockNumber' AS number FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders'",[b.id]);const byId=new Map(orders.map(r=>[r.source_id,r])),byNumber=new Map(),stockById=new Map(stock.map(r=>[r.source_id,r]));for(const r of orders)byNumber.set(r.order_number,byNumber.has(r.order_number)?null:r)
  const {buildReplicaOrganization}=require('../backend/src/modules/workbench-replica/local-workbench-organization')
  const nodes=await q.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[b.workspace_owner_id])
  const {collectedOrganizationQuery}=require('../backend/src/modules/workbench-replica/collected-organization-query')
  const employees=await q.query(collectedOrganizationQuery,[b.workspace_owner_id,b.tenant_id,b.company_id])
  const org=buildReplicaOrganization({id:b.workspace_owner_id,role:'admin',accountDisabled:false},b.workspace_owner_id,nodes,employees,{tenant_id:b.tenant_id,source_company_id:b.company_id})
  const verifiedEmployees=new Set(org.members.map(r=>r.employeeId)),report=[]
  for(const c of captures){const rows=c.normalized.map(r=>associate(r,byId,byNumber,stockById,verifiedEmployees));if(Date.parse(b.metadata?.analyticsCaptures?.[c.manifest.entityType]?.capturedAt??'')>Date.parse(c.manifest.capturedAt))throw Error('stale_analytics_capture')
   for(let n=0;n<rows.length;n+=200){const part=rows.slice(n,n+200);await q.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,owner_employee_id,customer_id,department_id,created_at,paid_at,source_paid_at,occurred_at,amount,currency_code,quantity,raw_status,facts,raw,captured_at)
    SELECT $1,x.entity_type,x.source_id,x.company_id,x.document_number,x.owner_employee_id,x.customer_id,x.department_id,x.created_at,x.paid_at,x.source_paid_at,x.occurred_at,x.amount,x.currency_code,x.quantity,x.raw_status,x.facts,x.raw,x.captured_at FROM jsonb_to_recordset($2::jsonb) x(entity_type text,source_id text,company_id text,document_number text,owner_employee_id text,customer_id text,department_id text,created_at timestamptz,paid_at timestamptz,source_paid_at timestamptz,occurred_at timestamptz,amount numeric,currency_code text,quantity numeric,raw_status text,facts jsonb,raw jsonb,captured_at timestamptz)
    ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET
    company_id=excluded.company_id,document_number=excluded.document_number,owner_employee_id=excluded.owner_employee_id,customer_id=excluded.customer_id,department_id=excluded.department_id,
    created_at=excluded.created_at,paid_at=excluded.paid_at,source_paid_at=excluded.source_paid_at,occurred_at=excluded.occurred_at,amount=excluded.amount,currency_code=excluded.currency_code,quantity=excluded.quantity,raw_status=excluded.raw_status,facts=excluded.facts,raw=excluded.raw,captured_at=excluded.captured_at
    WHERE ${analyticsShouldApplySql}`,[b.id,JSON.stringify(part)])}
   const meta={captureId:c.manifest.captureId,capturedAt:c.manifest.capturedAt,finishedAt:c.manifest.finishedAt,coverage:c.manifest.coverage,consistentSnapshot:false,rowCount:rows.length,pageCount:c.manifest.pages.length,operation:c.manifest.operation,companyId:c.manifest.companyId,verifiedOwnerRows:rows.filter(r=>r.owner_employee_id).length}
   await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{analyticsCaptures}',coalesce(metadata->'analyticsCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({[c.manifest.entityType]:meta})]);report.push({entity:c.manifest.entityType,...meta})
  }
  const salesSourceStatus=captures.some(c=>c.manifest.entityType==='fulfillment')
   ?await require('./workbench-sales-source-status.cjs').refreshSalesSourceStatuses(q,b.id):undefined
  const stockNative=captures.some(c=>c.manifest.entityType==='stock')?await require('./workbench-stock-native.cjs').refreshStockNative(q,b.id):undefined
  return {imported:true,formalReplicaActivated:false,reports:report,salesSourceStatus,stockNative}
 });console.log(JSON.stringify(result))}finally{await db.destroy()}
}
module.exports={loadCapture,associate,analyticsShouldApplySql}
if(require.main===module)main().catch(()=>{console.error('analytics_import_failed; no partial transaction published, private data not logged');process.exitCode=1})
