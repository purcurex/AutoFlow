#!/usr/bin/env node
'use strict'
// Offline only. Never import historical first-page samples as complete captures.
const fs=require('fs'),path=require('path'),{parseEnv}=require('node:util'),{createHash}=require('node:crypto');
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});require('reflect-metadata');
const{DataSource}=require('typeorm'),{normalizeCollectedAllocation}=require('../backend/src/modules/fop-data/collected-allocation');
(async()=>{
 const file=process.argv[2];if(!file)throw Error('capture_file_required');const capture=JSON.parse(fs.readFileSync(file,'utf8'));
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),fop=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'));
 if(env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||env.WORKBENCH_SYNC_ENABLED!=='false'||/mock/i.test(env.DB_DATABASE))throw Error('persistent_real_pause_required');
 if(capture.sourceScope?.entityCode!=='hzkj_alloc_bill'||capture.sourceScope?.subject?.tenantId!==capture.context?.tenantId||capture.sourceScope?.subject?.userId!==capture.context?.userId||capture.sourceScope?.organizationIds?.length!==1||capture.sourceScope?.organizationIds?.[0]!==capture.companyId||capture.operation!=='queryAllocation'||capture.complete!==true||capture.coverage!=='full_company_scan'||capture.context?.tenantId!==(fop.FOP_REPLICA_TENANT_ID??env.FOP_REPLICA_TENANT_ID)||capture.context?.userId!==fop.FOP_KINGDEE_USER_ID||capture.companyId!==(fop.FOP_REPLICA_COMPANY_ID??env.FOP_REPLICA_COMPANY_ID)||typeof capture.capturedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(capture.capturedAt)||!Number.isFinite(Date.parse(capture.capturedAt))||!Array.isArray(capture.rows)||!capture.rows.length||capture.rowCount!==capture.rows.length)throw Error('invalid_or_empty_allocation_capture');
 const seen=new Set(),rows=capture.rows.map(raw=>{const display=normalizeCollectedAllocation(raw,capture.companyId);if(seen.has(display.id))throw Error('duplicate_allocation_id');seen.add(display.id);return{raw,display}});
 const ds=new DataSource({type:'postgres',host:env.DB_HOST,port:+env.DB_PORT,username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,logging:false});await ds.initialize();
 try{await ds.transaction(async q=>{
  const batches=await q.query("SELECT b.* FROM hz_fop_collected_batches b JOIN users u ON b.workspace_owner_id=coalesce(u.organization_workspace_owner_id,u.id) WHERE u.email='admin@hzdrop.com' AND b.tenant_id=$1 AND b.company_id=$2 AND b.state='active' FOR UPDATE",[capture.context.tenantId,capture.companyId]);if(batches.length!==1)throw Error('active_batch_required');const batch=batches[0];
  await q.query("DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='allocation'",[batch.id]);
  for(const{raw,display}of rows)await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,'allocation',$2,$3,$4,$5,$6,$7)",[batch.id,display.id,null,[display.number,display.sourceOrderId].join(' ').toLowerCase(),JSON.stringify(display),JSON.stringify(raw),capture.capturedAt]);
  await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[batch.id,JSON.stringify({allocation:{captureId:createHash('sha256').update(JSON.stringify(capture)).digest('hex'),capturedAt:capture.capturedAt,rowCount:rows.length,coverage:capture.coverage,companyId:capture.companyId,consistentSnapshot:false}})]);
  console.log(JSON.stringify({allocationRows:rows.length,fulfillmentRows:batch.row_count}));
 })}finally{await ds.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
