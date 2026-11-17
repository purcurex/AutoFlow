import test from 'node:test'
import assert from 'node:assert/strict'
import {timestampArguments,timestampPreflight,timestampPagedIdentityConfig,timestampPagedConnectionBasis,prepareTimestampPagedExecution,timestampExecutionConfig} from './workbench-timestamp-sync.mjs'
test('default is offline preflight, execution needs explicit flag',()=>{
 assert.equal(timestampArguments([]).execute,false)
 assert.deepEqual(timestampArguments(['--profile','p.json','--batch-id','00000000-0000-0000-0000-000000000001','--mode','reconcile','--execute']),{execute:true,mode:'reconcile',profile:'p.json','batch-id':'00000000-0000-0000-0000-000000000001'})
 assert.throws(()=>timestampArguments(['--force']))
})
test('execute cannot bypass pause, missing mapping, or an unqualified database',()=>{
 const r=timestampPreflight({FOP_QUERIES_PAUSED:'true',DB_HOST:'prod',DB_DATABASE:'prod'},{execute:true,mode:'incremental'},null)
 assert.equal(r.executable,false);assert.equal(r.upstreamCalled,false)
 assert.ok(r.blockedReasons.includes('fop_queries_paused'));assert.ok(r.blockedReasons.includes('timestamp_profile_required'));assert.ok(r.blockedReasons.includes('timestamp_explicit_local_database_required'))
})
test('ordinary profile preflight preserves pause and records pending publication',()=>{
 const report=timestampPreflight({FOP_QUERIES_PAUSED:'true'},{mode:'incremental'},{version:2,protocol:'ordinary_modified_pages',packageVersion:'2026-11-16',acknowledgeEventualConsistency:true})
 assert.equal(report.executable,false)
 assert.ok(report.blockedReasons.includes('fop_queries_paused'))
 assert.equal(report.clockBasis,'local_capture_time')
 assert.equal(report.projectionCoverage,'four_entities_transactional_local_projection; incomplete_records_pending')
})
const pagedProfile={version:2,protocol:'ordinary_modified_pages',packageVersion:'2026-11-16',acknowledgeEventualConsistency:true,tenantId:'tenant',companyId:'100000'}
const identityConfig=()=>({FOP_KINGDEE_TENANT_ID:'tenant',FOP_REPLICA_TENANT_ID:'tenant',FOP_KINGDEE_USER_ID:'original-user',FOP_KINGDEE_USERNAME:'integration',FOP_OPENAPI_USERNAME:'integration',FOP_KINGDEE_ORGANIZATION_IDS:'100000',FOP_QUERIES_PAUSED:'false'})
const connection=()=>({subject:{tenantId:'tenant',userId:'original-user'},currentOrganization:{id:'100000'}})
test('ordinary preflight binds profile tenant to every configured tenant and requires the original integration identity',()=>{
 for(const patch of [{FOP_KINGDEE_TENANT_ID:'other'},{FOP_REPLICA_TENANT_ID:'other'},{FOP_KINGDEE_USER_ID:''},{FOP_OPENAPI_USERNAME:'other'},{FOP_KINGDEE_ORGANIZATION_IDS:'other'}]){
  assert.throws(()=>timestampPagedIdentityConfig({...identityConfig(),...patch},pagedProfile))
  assert.equal(timestampPreflight({...identityConfig(),...patch},{mode:'incremental'},pagedProfile).executable,false)
 }
 assert.throws(()=>timestampPagedIdentityConfig({...identityConfig(),FOP_KINGDEE_TENANT_ID:'',FOP_REPLICA_TENANT_ID:''},pagedProfile),/configured_tenant_mismatch/)
 assert.equal(timestampPagedIdentityConfig(identityConfig(),pagedProfile).userId,'original-user')
})
test('live connection tenant/user/currentOrg must all match before token acquisition or business reads',async()=>{
 for(const key of ['tenantId','userId','companyId']){
  const current=connection();if(key==='companyId')current.currentOrganization.id='other';else current.subject[key]='other'
  let tokens=0,queries=0
  await assert.rejects(prepareTimestampPagedExecution(identityConfig(),pagedProfile,{getConnection:async()=>current,acquireToken:async()=>{tokens++;return 'secret'},query:async()=>{queries++}}),/timestamp_connection_identity_mismatch/)
  assert.equal(tokens,0);assert.equal(queries,0)
 }
})
test('verified connection basis remains distinct from scope proof and token acquisition occurs once across pages',async()=>{
 const config=identityConfig();let connections=0,tokens=0,queries=0
 const prepared=await prepareTimestampPagedExecution(config,pagedProfile,{getConnection:async()=>{connections++;return connection()},acquireToken:async()=>{tokens++;return 'private-token'},query:async(c,p)=>{assert.equal(c,config);assert.equal(c.FOP_OPENAPI_ACCESS_TOKEN,'private-token');queries++;return {page:p.pageNo}}})
 await prepared.query({pageNo:1});await prepared.query({pageNo:2})
 assert.deepEqual([connections,tokens,queries],[1,1,2]);assert.equal(prepared.identityBasis.basis,'kingdee_get_connection_context');assert.equal(prepared.identityBasis.scopeProof,false);assert.equal(prepared.identityBasis.stableScopeProof,false)
 assert.equal(JSON.stringify(prepared.identityBasis).includes('private-token'),false)
 config.FOP_QUERIES_PAUSED='true';await assert.rejects(prepared.query({pageNo:3}),/fop_queries_paused/);assert.equal(queries,2)
})
test('initial pause blocks even connection verification and wrong configured tenant also blocks it',async()=>{
 let calls=0
 const getConnection=async()=>{calls++;return connection()}
 await assert.rejects(prepareTimestampPagedExecution({...identityConfig(),FOP_QUERIES_PAUSED:'true'},pagedProfile,{getConnection}),/fop_queries_paused/)
 await assert.rejects(prepareTimestampPagedExecution(identityConfig(),{...pagedProfile,tenantId:'other'},{getConnection}),/timestamp_configured_tenant_mismatch/)
 assert.equal(calls,0)
})
test('strict profile preflight retains its original credential and scope flow',()=>{
 const config={FOP_OPENAPI_IDENTITY:'identity',FOP_OPENAPI_ACCESS_TOKEN:'private-token',DB_HOST:'127.0.0.1',DB_PORT:'55432',DB_DATABASE:'autoflow_local_demo'}
 const report=timestampPreflight(config,{mode:'incremental','batch-id':'00000000-0000-0000-0000-000000000001'},{version:1,verified:true,tenantId:'strict-tenant'})
 assert.equal(report.executable,true);assert.equal(report.protocol,'strict_keyset')
})

test('explicit one-shot permits only a memory override while automation remains disabled',()=>{
 const config={FOP_QUERIES_PAUSED:'true',WORKBENCH_SYNC_ENABLED:'false',WORKBENCH_AUTOMATIC_CALLS_ENABLED:'false'}
 const options=timestampArguments(['--execute','--authorize-one-shot'])
 assert.equal(timestampExecutionConfig(config,options).FOP_QUERIES_PAUSED,'false')
 assert.equal(config.FOP_QUERIES_PAUSED,'true')
 assert.equal(timestampExecutionConfig(config,{execute:true}).FOP_QUERIES_PAUSED,'true')
 assert.throws(()=>timestampArguments(['--authorize-one-shot']),/requires_execute/)
 for(const key of ['WORKBENCH_SYNC_ENABLED','WORKBENCH_AUTOMATIC_CALLS_ENABLED'])for(const value of ['true',undefined])assert.throws(()=>timestampExecutionConfig({...config,[key]:value},options),/automation_must_be_disabled/)
})
