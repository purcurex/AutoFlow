#!/usr/bin/env node
// Explicit offline reconciliation of previously selected account/person pairs. No network calls.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util'),{createHash,randomUUID}=require('node:crypto')
async function reconcileAnalyticsOwners(query,connection,{dryRun=true,backupFile}={}){
 const {collectedOrganizationQuery}=require('../backend/src/modules/workbench-replica/collected-organization-query')
 const {buildReplicaOrganization}=require('../backend/src/modules/workbench-replica/local-workbench-organization')
 const c=connection,[batch]=await query("SELECT * FROM hz_fop_collected_batches WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active' FOR UPDATE",[c.workspace_owner_id,c.tenant_id,c.source_company_id])
 if(!batch)throw Error('active_batch_required')
 const nodes=await query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[c.workspace_owner_id])
 const employees=await query(collectedOrganizationQuery,[c.workspace_owner_id,c.tenant_id,c.source_company_id])
 const org=buildReplicaOrganization({id:c.workspace_owner_id,role:'admin'},c.workspace_owner_id,nodes,employees,c)
 // Same unique source-owner rule as analytics-import.associate; never fill ambiguous merged documents.
 const rows=await query(`SELECT f.entity_type,f.source_id,f.owner_employee_id,f.facts,f.raw->>'hzkj_operator_id' AS owner
  FROM hz_fop_collected_analytics_facts f WHERE f.batch_id=$1 AND f.company_id=$2 AND f.owner_employee_id IS NULL
   AND f.facts->'scope'->>'verified'='true' AND f.raw->>'hzkj_operator_id'=ANY($3::text[])
   AND ((f.entity_type='fulfillment' AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_orders o WHERE o.batch_id=f.batch_id AND o.source_id=f.source_id))
    OR (f.entity_type='stock' AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=f.batch_id AND e.entity_type='stock_orders' AND e.source_id=f.source_id
     AND NOT(e.owner_employee_id IS NULL AND e.display->'nativeStockSource'->>'sourceId'=f.source_id AND e.display->>'stockNumber'=f.document_number
      AND e.raw->>'hzkj_operator_id'=f.raw->>'hzkj_operator_id' AND (e.display->'nativeStockSource'->>'capturedAt')::timestamptz=f.captured_at))))
   FOR UPDATE OF f`,[batch.id,batch.company_id,org.members.map(m=>m.employeeId)])
 if(!dryRun&&rows.length){
  if(!backupFile)throw Error('analytics_backup_required')
  fs.writeFileSync(backupFile,JSON.stringify({batchId:batch.id,metadata:batch.metadata,rows}),{mode:0o600,flag:'wx'})
  for(const row of rows){const facts={...row.facts,sourceOwnershipVerified:true,association:{state:'verified',basis:'source_owner_matches_verified_local_employee_master_id',sourceOrderIds:[],ownerEmployeeIds:[row.owner]}}
   await query('UPDATE hz_fop_collected_analytics_facts SET owner_employee_id=$4,facts=$5::jsonb WHERE batch_id=$1 AND entity_type=$2 AND source_id=$3',[batch.id,row.entity_type,row.source_id,row.owner,JSON.stringify(facts)])}
  const captures={...batch.metadata.analyticsCaptures}
  for(const entity of new Set(rows.map(r=>r.entity_type))){const [count]=await query('SELECT count(*)::int n FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type=$2 AND owner_employee_id IS NOT NULL',[batch.id,entity]);captures[entity]={...captures[entity],verifiedOwnerRows:count.n,ownershipReconciledAt:new Date().toISOString()}}
  await query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{analyticsCaptures}',$2::jsonb) WHERE id=$1",[batch.id,JSON.stringify(captures)])
  if(rows.some(r=>r.entity_type==='stock'))await require('./workbench-stock-native.cjs').refreshStockNative({query},batch.id,{backupFile:backupFile+'.stock.json'})
 }
 return {rows:rows.length,byEntity:Object.fromEntries([...new Set(rows.map(r=>r.entity_type))].map(entity=>[entity,rows.filter(r=>r.entity_type===entity).length]))}
}
async function main(){
 const [mode,capturePath,selectionsPath]=process.argv.slice(2)
 if(!['--dry-run','--apply'].includes(mode)||!capturePath||!selectionsPath)throw Error('usage: --dry-run|--apply directory-envelope.json confirmed-selections.json')
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(e.DB_DATABASE!=='autoflow_local_demo'||e.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(e.DB_HOST)
  ||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false')throw Error('explicit_paused_local_target_required')
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
 const {planCapturedEmployeeBindings}=require('../backend/src/modules/workbench-replica/captured-employee-bindings')
 const raw=fs.readFileSync(capturePath,'utf8'),capture=JSON.parse(raw),selections=JSON.parse(fs.readFileSync(selectionsPath,'utf8'))
 const {Client}=require('pg'),client=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE})
 await client.connect()
 try{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='30s'")
  const query=async(s,p)=>(await client.query(s,p)).rows
  const sources=await query(`SELECT c.id,c.workspace_owner_id,c.tenant_id,co.source_company_id FROM hz_fop_connections c
   JOIN hz_fop_companies co ON co.connection_id=c.id JOIN hz_fop_collected_batches batch
    ON batch.workspace_owner_id=c.workspace_owner_id AND batch.tenant_id=c.tenant_id AND batch.company_id=co.source_company_id
   WHERE c.capabilities->>'offlineCollectedOnly'='true' AND batch.state='active' AND c.tenant_id=$1 AND co.source_company_id=$2 FOR UPDATE OF c,co`,['hyperzone.test','100000'])
  if(sources.length!==1)throw Error('one_offline_collected_source_required')
  const c=sources[0],scope={workspaceOwnerId:c.workspace_owner_id,tenantId:c.tenant_id,companyId:c.source_company_id}
  // Lock the selected directory rows so a concurrent transfer/rebind cannot race the repair.
  await query('SELECT id FROM organization_employees WHERE owner_user_id=$1 FOR UPDATE',[c.workspace_owner_id])
  await query('SELECT u.id FROM users u JOIN organization_employees e ON e.account_id=u.id WHERE e.owner_user_id=$1 FOR UPDATE OF u',[c.workspace_owner_id])
  const employees=await query(`SELECT e.id,e.owner_user_id,e.account_id,e.name,e.archived_at,u.account_disabled,u.fop_tenant_id,u.fop_user_id,b.id AS binding_id
   FROM organization_employees e LEFT JOIN users u ON u.id=e.account_id LEFT JOIN hz_fop_employee_bindings b
    ON b.local_account_id=e.account_id AND b.connection_id=$2 WHERE e.owner_user_id=$1`,[c.workspace_owner_id,c.id])
  const plans=planCapturedEmployeeBindings(capture,selections,employees,scope),dryRun=mode==='--dry-run'
  if(!dryRun){
   const dir=path.resolve('.runtime/employee-department-link');fs.mkdirSync(dir,{recursive:true,mode:0o700})
   fs.writeFileSync(path.join(dir,`before-${Date.now()}.json`),JSON.stringify({connectionId:c.id,bindings:await query('SELECT * FROM hz_fop_employee_bindings WHERE connection_id=$1',[c.id]),plannedAccountIds:plans.map(p=>p.localAccountId)}),{mode:0o600,flag:'wx'})
   for(const p of plans)await query(`INSERT INTO hz_fop_employee_bindings(id,connection_id,local_account_id,person_record_id,employee_master_id,
     employee_number,username,display_name,state,enabled,directory_verified_at,last_checked_at,evidence)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'directory_verified',true,$9,now(),$10::jsonb)`,
    [randomUUID(),c.id,p.localAccountId,p.personRecordId,p.employeeMasterId,p.employeeNumber,p.username,p.displayName,p.directoryVerifiedAt,
      JSON.stringify({...p.evidence,captureSha256:createHash('sha256').update(raw).digest('hex')})])
  }
  const analytics=await reconcileAnalyticsOwners(query,c,{dryRun,backupFile:dryRun?undefined:path.resolve('.runtime/employee-department-link',`analytics-before-${Date.now()}.json`)})
  await client.query(dryRun?'ROLLBACK':'COMMIT')
  console.log(JSON.stringify({dryRun,mappings:plans.length,analytics,upstreamCalled:false,connectionChanged:false,authenticationIdentityChanged:false}))
 }catch(error){await client.query('ROLLBACK');throw error}finally{await client.end()}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1})
module.exports={reconcileAnalyticsOwners}
