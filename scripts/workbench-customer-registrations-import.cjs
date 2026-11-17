#!/usr/bin/env node
// Offline import only. Requires an explicit env file and batch ID; never runs migrations.
const fs = require('node:fs'), path = require('node:path'), { parseEnv } = require('node:util')
async function loadCustomerRegistrationCapture(directory, expected) {
  const { sha, registrationWindow, validateRegistrationPage, registrationScopeProof } = await import('./workbench-customer-registrations-capture.mjs')
  const m = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))
  if (m.version !== 1 || m.complete !== true || m.operation !== 'customer-registrations' || m.entityType !== 'registrations' || m.sourceEntity !== 'hzkj_member_customer' || m.coverage !== 'company_creation_window' || m.consistentSnapshot !== false || m.companyId !== expected.companyId || m.context?.tenantId !== expected.tenantId || m.context?.userId !== expected.userId || !m.captureId || !Array.isArray(m.pages) || !m.pages.length || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(m.capturedAt) || !Number.isFinite(Date.parse(m.capturedAt))) throw Error('invalid_manifest')
  if (m.connectionProof?.basis !== 'authenticated_connection_context' || m.connectionProof.tenantId !== expected.tenantId || m.connectionProof.userId !== expected.userId || m.connectionProof.companyId !== expected.companyId || !['native_response_createorg_conjunction','user_confirmed_company_catalogue'].includes(m.scopeProof?.basis) || m.scopeProof.companyId !== expected.companyId) throw Error('source_scope_unverified')
  const window = registrationWindow(m.from,m.toExclusive), rows = [], seen = new Set(); let total
  for (let i = 0; i < m.pages.length; i++) {
    const p = m.pages[i]
    if (p.file !== `page-${String(i+1).padStart(4,'0')}.json`) throw Error('invalid_page_path')
    const raw = fs.readFileSync(path.join(directory,p.file),'utf8')
    if (sha(raw) !== p.sha256) throw Error('capture_hash_mismatch')
    const envelope = JSON.parse(raw)
    const proof = registrationScopeProof(envelope?.data?.filter,m.companyId,expected)
    if (Object.keys(proof).length !== Object.keys(m.scopeProof).length || Object.entries(proof).some(([key,value]) => m.scopeProof[key] !== value)) throw Error('source_scope_unverified')
    total = validateRegistrationPage(envelope,i+1,envelope.data?.pageSize,total,seen)
    if (!Number.isInteger(envelope.data.pageSize) || envelope.data.pageSize < 1 || envelope.data.pageSize > 100 || envelope.data.lastPage !== (i === m.pages.length-1) || envelope.data.rows.length !== p.rows) throw Error('invalid_page_proof')
    rows.push(...envelope.data.rows.filter(r => r.createorg_id === m.companyId))
  }
  if (rows.length !== m.rowCount || seen.size !== m.sourceRowCount) throw Error('capture_count_mismatch')
  return { manifest: m, rows, window }
}
async function importCustomerRegistrations(db, batchId, capture, normalize) {
  const { manifest: m, rows, window } = capture
  const normalized = rows.map(raw => normalize(raw,{companyId:m.companyId,capturedAt:m.capturedAt}))
  if (normalized.some(r => r.created_at && (r.created_at < window.start || r.created_at >= window.end))) throw Error('row_outside_creation_window')
  return db.transaction(async q => {
    const batches = await q.query("SELECT * FROM hz_fop_collected_batches WHERE id=$1 AND state='active' FOR UPDATE",[batchId]), b = batches[0]
    if (batches.length !== 1 || b.company_id !== m.companyId || b.tenant_id !== m.context.tenantId) throw Error('active_batch_scope_mismatch')
    const prior = b.metadata?.analyticsCaptures?.registrations
    if (prior && Date.parse(prior.capturedAt) > Date.parse(m.capturedAt)) throw Error('stale_registration_capture')
    await q.query('DELETE FROM hz_fop_collected_customer_registrations WHERE batch_id=$1',[batchId])
    for (let i=0;i<normalized.length;i+=200) await q.query(`INSERT INTO hz_fop_collected_customer_registrations(batch_id,source_id,company_id,source_entity,source_owner_user_id,created_at,raw,captured_at)
      SELECT $1,x.source_id,x.company_id,x.source_entity,x.source_owner_user_id,x.created_at,x.raw,x.captured_at
      FROM jsonb_to_recordset($2::jsonb) x(source_id text,company_id text,source_entity text,source_owner_user_id text,created_at timestamptz,raw jsonb,captured_at timestamptz)`,[batchId,JSON.stringify(normalized.slice(i,i+200))])
    const metadata = { captureId:m.captureId,capturedAt:m.capturedAt,companyId:m.companyId,coverage:m.coverage,scopeProof:m.scopeProof,connectionProof:m.connectionProof,consistentSnapshot:false,from:m.from,toExclusive:m.toExclusive,start:window.start,end:window.end,rowCount:rows.length,sourceRowCount:m.sourceRowCount,pageCount:m.pages.length,operation:m.operation,sourceEntity:m.sourceEntity }
    await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{analyticsCaptures}',coalesce(metadata->'analyticsCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[batchId,JSON.stringify({registrations:metadata})])
    return { imported:true,rowCount:rows.length,unknownCreationTime:normalized.filter(r=>!r.created_at).length,automaticCallsEnabled:false }
  })
}
async function main() {
  const a=process.argv.slice(2), dry=a.includes('--dry-run'), args=a.filter(x=>x!=='--dry-run')
  if (args.length!==6 || args[0]!=='--env' || args[2]!=='--batch' || args[4]!=='--capture') throw Error('explicit_env_batch_capture_required')
  const env=parseEnv(fs.readFileSync(args[1],'utf8'))
  if (env.FOP_QUERIES_PAUSED!=='true' || env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false' || env.WORKBENCH_SYNC_ENABLED!=='false' || !env.DB_DATABASE || !env.DB_HOST || !env.DB_PORT || !env.FOP_REPLICA_TENANT_ID || !env.FOP_REPLICA_COMPANY_ID || !env.FOP_KINGDEE_USER_ID) throw Error('explicit_paused_target_required')
  require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
  const {normalizeCustomerRegistration}=require('../backend/src/modules/fop-data/collected-customer-registration')
  const capture=await loadCustomerRegistrationCapture(args[5],{tenantId:env.FOP_REPLICA_TENANT_ID,companyId:env.FOP_REPLICA_COMPANY_ID,userId:env.FOP_KINGDEE_USER_ID})
  const normalized=capture.rows.map(r=>normalizeCustomerRegistration(r,{companyId:capture.manifest.companyId,capturedAt:capture.manifest.capturedAt}))
  if(normalized.some(r=>r.created_at&&(r.created_at<capture.window.start||r.created_at>=capture.window.end)))throw Error('row_outside_creation_window')
  if(dry){console.log(JSON.stringify({valid:true,rows:normalized.length,missingCreatedAt:normalized.filter(r=>!r.created_at).length}));return}
  const {DataSource}=require('typeorm'),db=new DataSource({type:'postgres',host:env.DB_HOST,port:+env.DB_PORT,username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,logging:false})
  await db.initialize()
  try { console.log(JSON.stringify(await importCustomerRegistrations(db,args[3],capture,normalizeCustomerRegistration))) } finally { await db.destroy() }
}
module.exports={loadCustomerRegistrationCapture,importCustomerRegistrations}
if(require.main===module)main().catch(()=>{console.error('customer_registration_import_failed; no partial transaction published, private data not logged');process.exitCode=1})
