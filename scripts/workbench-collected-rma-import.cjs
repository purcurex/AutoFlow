#!/usr/bin/env node
'use strict'
// Offline capture only. This does not call FOP or execute after-sales actions.
const fs=require('fs'),path=require('path'),{parseEnv}=require('node:util'),{createHash}=require('node:crypto');
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});require('reflect-metadata');
const{DataSource}=require('typeorm'),{normalizeCollectedRma,validateCollectedRmaCapture,collectedRmaParents}=require('../backend/src/modules/fop-data/collected-rma');
(async()=>{
 const file=process.argv[2];if(!file)throw Error('capture_file_required');const capture=JSON.parse(fs.readFileSync(file,'utf8'));
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),fop=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'));
 const cases=validateCollectedRmaCapture(capture,fop,env);
 const ds=new DataSource({type:'postgres',host:env.DB_HOST,port:+env.DB_PORT,username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,logging:false});await ds.initialize();
 try{await ds.transaction(async q=>{
  const batches=await q.query("SELECT b.* FROM hz_fop_collected_batches b JOIN users u ON b.workspace_owner_id=coalesce(u.organization_workspace_owner_id,u.id) WHERE u.email='admin@hzdrop.com' AND b.tenant_id=$1 AND b.company_id=$2 AND b.state='active' FOR UPDATE",[capture.context.tenantId,capture.companyId]);if(batches.length!==1)throw Error('active_batch_required');const batch=batches[0];
  const orders=await q.query('SELECT source_id,order_number,owner_employee_id,display,raw FROM hz_fop_collected_orders WHERE batch_id=$1',[batch.id]),parents=collectedRmaParents(orders,capture.sourceOrders,capture.companyId);
  const rows=cases.map(({raw,payerCustomerId})=>normalizeCollectedRma(raw,{companyId:capture.companyId,payerCustomerId,parents}));
  const payerIds=[...new Set(capture.pages.map(p=>p.payerCustomerId))];
  await q.query("DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='rma' AND (raw->>'payerCustomerId'=ANY($2::text[]) OR source_id=ANY($3::text[]))",[batch.id,payerIds,rows.map(r=>r.id)]);
  for(const row of rows){const d=row.display;await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,'rma',$2,$3,$4,$5,$6,$7)",[batch.id,row.id,row.ownerEmployeeId,[d.orderNumber,d.shopifyOrderNumber,d.customerName,d.storeName,d.owner?.name,...d.items.flatMap(i=>[i.sku,i.name]),...d.rmaCases.flatMap(c=>[c.number,c.stage,c.reason])].filter(Boolean).join(' ').toLowerCase(),JSON.stringify(d),JSON.stringify({case:row.raw,payerCustomerId:row.association.payerCustomerId,sourceOrders:capture.sourceOrders.filter(o=>o.billno===row.association.sourceNumber&&o.hzkj_shop_id===row.association.shopId)}),capture.capturedAt])}
  const [counts]=await q.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE display->'rmaAssociation'->>'state'<>'verified')::int AS exceptions,count(*) FILTER (WHERE display->'rmaAssociation'->>'companyVerified' IS DISTINCT FROM 'true')::int AS quarantined FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='rma'",[batch.id]);
  const payerCaptures={...(batch.metadata?.entityCaptures?.rma?.payerCaptures??{})};for(const payerId of payerIds)payerCaptures[payerId]={capturedAt:capture.capturedAt,rowCount:cases.filter(r=>r.payerCustomerId===payerId).length};
  const exceptions=counts.exceptions;
  await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1",[batch.id,JSON.stringify({rma:{captureId:createHash('sha256').update(JSON.stringify([batch.metadata?.entityCaptures?.rma?.captureId??null,capture])).digest('hex'),capturedAt:capture.capturedAt,rowCount:counts.total,exceptionCount:exceptions,quarantineCount:counts.quarantined,coverage:capture.coverage,capturedPayerCount:Object.keys(payerCaptures).length,payerCaptures,companyId:capture.companyId,consistentSnapshot:false,sourceEntity:'hzkj_after_sale_orders',parentRelation:'unique_source_number_shop_payer_same_company',executionAvailable:false}})]);
  console.log(JSON.stringify({rmaRows:counts.total,verifiedRows:counts.total-exceptions,exceptionRows:exceptions,quarantineRows:counts.quarantined,importedRows:rows.length,coverage:capture.coverage,fulfillmentRows:batch.row_count}));
 })}finally{await ds.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
