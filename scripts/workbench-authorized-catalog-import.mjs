#!/usr/bin/env node
// Offline publication of fully checked company catalogues. Never deletes absent documents.
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {readSyncConfig,syncDatabaseOptions,syncRuntimeRequire,syncScope} from './workbench-sync-runtime.mjs'
import {catalogOperations,validateCatalogPage} from './workbench-authorized-catalog-capture.mjs'
export function loadCatalog(directory,scope){const m=JSON.parse(readFileSync(resolve(directory,'manifest.json')));if(!m.complete||m.tenantId!==scope.tenantId||m.companyId!==scope.companyId||m.orgNumber!==scope.orgNumber||!catalogOperations.includes(m.operation))throw Error('catalog_scope_mismatch');const rows=[],seen=new Set();let total
 for(let i=0;i<m.pages.length;i++){const p=m.pages[i];if(p.file!==`page-${String(i+1).padStart(4,'0')}.json`)throw Error('catalog_page_path');const raw=readFileSync(resolve(directory,p.file),'utf8');if(createHash('sha256').update(raw).digest('hex')!==p.sha256)throw Error('catalog_hash_mismatch');const body=JSON.parse(raw);total=validateCatalogPage(body,{pageNo:i+1,pageSize:m.pageSize??100,total,seen,...scope});if(body.data.lastPage!==(i===m.pages.length-1))throw Error('catalog_incomplete');rows.push(...body.data.rows)}
 if(rows.length!==m.rows||seen.size!==total)throw Error('catalog_count_mismatch');return {m,rows}
}
export async function importCatalogues({config:c,db,directory,only=catalogOperations}){const scope={tenantId:c.FOP_REPLICA_TENANT_ID,companyId:c.FOP_REPLICA_COMPANY_ID,orgNumber:syncScope(c).orgNumber},runtime=syncRuntimeRequire(c),r=createRequire(resolve('backend/package.json'))
 const {normalizeCollectedAnalyticsFact}=runtime('fop-data/collected-analytics-facts'),{normalizeTimestampProjectionRaw}=runtime('workbench-replica/timestamp-projection-normalizer'),{projectPurchaseOrderRows,purchaseGroupFacts}=runtime('fop-data/collected-purchase-association'),{projectReceiptNotice}=runtime('fop-data/collected-receipt-notice')
 const report=[];if(only.some(v=>!catalogOperations.includes(v)))throw Error('unknown_catalog_operation');
 try{for(const op of ['stock','purchase','purchase-requisition','receipt-notice','outbound-list','receipt','rma','inbound','payment','customer-registrations'].filter(op=>!only||only.includes(op))){
  let capture;try{capture=loadCatalog(resolve(directory,op),scope)}catch(e){report.push({operation:op,imported:false,error:e.message});continue}
  const fingerprint=catalogFingerprint(capture.rows)
  const [prior]=await db.query("SELECT metadata->'catalogFingerprints'->>$3 fingerprint FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2",[scope.tenantId,scope.companyId,op]);
  if(prior?.fingerprint===fingerprint){report.push({operation:op,imported:true,unchanged:true,rows:capture.rows.length});continue}
  const remember=()=>db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{catalogFingerprints}',coalesce(metadata->'catalogFingerprints','{}')||$3::jsonb) WHERE state='active' AND tenant_id=$1 AND company_id=$2",[scope.tenantId,scope.companyId,JSON.stringify({[op]:fingerprint})]);
  if(op==='purchase'){
   const {TimestampPostgresStore}=runtime('workbench-replica/timestamp-postgres'),{validateTimestampDocument}=runtime('workbench-replica/timestamp-sync')
   const bs=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2",[scope.tenantId,scope.companyId]);if(bs.length!==1)throw Error('active_batch_ambiguous')
   const identity={batchId:bs[0].id,tenantId:scope.tenantId,companyId:scope.companyId,entityCode:'hzkj_purorderbill'},time=v=>!v?null:/Z$|[+-]\d\d:\d\d$/.test(v)?v:v.replace(' ','T')+'+08:00'
   const docs=capture.rows.map(raw=>({id:raw.id,companyId:scope.companyId,createdAt:time(raw.createtime),modifiedAt:time(raw.modifytime),raw}));for(const d of docs)validateTimestampDocument(d,identity)
   const result=await new TimestampPostgresStore(db).exclusive(identity,async session=>{const runId=await session.start('reconcile',null,null);try{for(let i=0;i<docs.length;i+=100)await session.stage(runId,docs.slice(i,i+100),{page:i/100,source:'authorized_company_catalogue'});return await session.commit(runId,null,[],false,{protocol:'authorized_company_catalogue',capturedAt:capture.m.capturedAt,complete:true,consistentSnapshot:false,deletionDetection:'not_inferred'})}catch(e){await session.fail(runId,'timestamp_catalogue_publish_failed');throw e}})
   const summary={operation:op,imported:true,rows:docs.length,state:result.state,pendingProjection:result.pendingProjection};report.push(summary);console.log(JSON.stringify(summary));await remember();continue
  }
  if(op==='customer-registrations'){
   const {m,rows}=capture;if(!m.userId||m.userId!==c.FOP_KINGDEE_USER_ID)throw Error('catalog_identity_missing')
   const {normalizeCustomerRegistration}=runtime('fop-data/collected-customer-registration')
   const bs=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2",[scope.tenantId,scope.companyId]);if(bs.length!==1)throw Error('active_batch_ambiguous')
   const cap={rows,window:{start:'1970-01-01T00:00:00.000Z',end:m.capturedAt},manifest:{...m,captureId:createHash('sha256').update(JSON.stringify(m)).digest('hex'),context:{tenantId:m.tenantId,userId:m.userId},coverage:'company_creation_window',sourceEntity:'hzkj_member_customer',sourceRowCount:rows.length,from:'1970-01-01 08:00:00',toExclusive:m.capturedAt,scopeProof:{basis:'native_response_org_conjunction',companyId:m.companyId},connectionProof:{basis:'authenticated_connection_context',tenantId:m.tenantId,userId:m.userId,companyId:m.companyId}}}
   const result=await r('../scripts/workbench-customer-registrations-import.cjs').importCustomerRegistrations(db,bs[0].id,cap,normalizeCustomerRegistration);report.push({operation:op,...result});console.log(JSON.stringify({operation:op,...result}));await remember();continue
  }
  const result=await db.transaction(async q=>{
   const bs=await q.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2 FOR UPDATE",[scope.tenantId,scope.companyId]);if(bs.length!==1)throw Error('active_batch_scope_changed');const b=bs[0],{m,rows}=capture
   const orders=['stock','receipt','receipt-notice','rma'].includes(op)?await q.query('SELECT source_id,order_number,owner_employee_id,customer_id,display,raw FROM hz_fop_collected_orders WHERE batch_id=$1',[b.id]):[],byNo=new Map(),byId=new Map(orders.map(o=>[o.source_id,o]));for(const o of orders)byNo.set(o.order_number,byNo.has(o.order_number)?null:o)
   const entities=await q.query('SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1',[b.id]),purchases=new Map(entities.filter(e=>e.entity_type==='purchase').map(e=>[e.source_id,e.raw]))
   const other=new Map(entities.filter(e=>e.entity_type==='stock_orders').map(e=>[e.display.stockNumber,{id:e.source_id,kind:'stock'}]))
   let saved=0,unresolved=0,consumptionIssue=null;const links={};const rmaModule=op==='rma'?runtime('fop-data/collected-rma'):null;const parents=rmaModule?rmaModule.collectedRmaParents(orders,[],b.company_id):[]
   const upsert=async(type,raw,display,owner=null)=>q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET owner_employee_id=excluded.owner_employee_id,search_text=excluded.search_text,display=excluded.display,raw=excluded.raw,captured_at=excluded.captured_at WHERE hz_fop_collected_entities.captured_at<=excluded.captured_at`,[b.id,type,raw.id,owner,JSON.stringify(display).toLowerCase(),JSON.stringify(display),JSON.stringify(raw),m.capturedAt])
   const knownEmployees=new Set((await q.query('SELECT DISTINCT owner_employee_id FROM hz_fop_collected_orders WHERE batch_id=$1 AND owner_employee_id IS NOT NULL',[b.id])).map(o=>o.owner_employee_id))
   for(const input of rows){
    const raw=op==='purchase'?normalizeTimestampProjectionRaw('hzkj_purorderbill',input,b.company_id,purchases.get(input.id)):input
    if(['stock','purchase','receipt'].includes(op)){
     const a=normalizeCollectedAnalyticsFact(op,input,{companyId:b.company_id,capturedAt:m.capturedAt,scopeVerified:true})
     const associate=r('../scripts/workbench-analytics-import.cjs').associate
     associate(a,byId,byNo,new Map(entities.filter(e=>e.entity_type==='stock_orders').map(e=>[e.source_id,{...e,number:e.display.stockNumber}])),knownEmployees)
     const columns=Object.keys(a),params=columns.map(k=>typeof a[k]==='object'&&a[k]!==null?JSON.stringify(a[k]):a[k])
     await q.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,${columns.map(k=>'"'+k+'"').join(',')}) VALUES($1,${columns.map((_,i)=>'$'+(i+2)).join(',')}) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET ${columns.filter(k=>!['entity_type','source_id'].includes(k)).map(k=>'"'+k+'"=excluded."'+k+'"').join(',')} WHERE hz_fop_collected_analytics_facts.captured_at<=excluded.captured_at`,[b.id,...params])
    }
    if(op==='purchase'){const p=projectPurchaseOrderRows(raw,n=>byNo.get(n)?.raw,id=>byId.get(id)?.display);unresolved+=p.unresolved;await upsert('purchase',raw,purchaseGroupFacts(raw,p.rows,p.unresolved))}
    else if(op==='receipt-notice'){const p=projectReceiptNotice(raw,purchases,n=>byNo.get(n)?.raw,n=>other.get(n));Object.assign(links,p.links);unresolved+=p.issues.length;await upsert('receipt_notice',raw,p.display)}
    else if(op==='rma'){const candidates=parents.filter(p=>p.order_number===raw.hzkj_srcnumber&&p.shop_id===raw.hzkj_shop_id);const payer=candidates.length===1?candidates[0].payer_customer_id:null;if(!payer){unresolved++;await q.query("UPDATE hz_fop_collected_entities SET owner_employee_id=null,display=jsonb_set(display,'{rmaAssociation}',jsonb_build_object('state','unmatched','companyVerified',false)),captured_at=$3 WHERE batch_id=$1 AND entity_type='rma' AND source_id=$2 AND captured_at<=$3",[b.id,raw.id,m.capturedAt]);await upsert('rma_unresolved_capture',raw,{id:raw.id,number:raw.number,reason:'source_order_payer_unresolved'});continue}const normalized=rmaModule.normalizeCollectedRma(raw,{companyId:b.company_id,payerCustomerId:payer,parents});if(normalized.association.state!=='verified')unresolved++;await upsert('rma',{id:raw.id,case:raw,payerCustomerId:payer},normalized.display,normalized.ownerEmployeeId)}
    else if(op==='inbound'||op==='payment')await upsert(op,raw,{id:raw.id,number:raw.billno,rawBillStatus:raw.billstatus})
    else if(op!=='stock')await upsert({'purchase-requisition':'purchase_application','outbound-list':'outbound',receipt:'receipt'}[op],raw,{id:raw.id,number:raw.billno,rawBillStatus:raw.billstatus})
    saved++
   }
   if(['stock','receipt'].includes(op))await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{analyticsCaptures}',coalesce(metadata->'analyticsCaptures','{}')||$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({[op]:{companyId:b.company_id,capturedAt:m.capturedAt,rowCount:saved,coverage:'full_company_scan',complete:true,consistentSnapshot:false}})]);
   if(op==='stock'){
    await r('../scripts/workbench-stock-native.cjs').refreshStockNative(q,b.id,{projector:runtime('fop-data/collected-stock-native').projectCollectedStockNative})
    await q.query('SAVEPOINT stock_consumption_capture')
    try{const {replaceStockConsumptionSnapshot}=runtime('workbench-replica/collected-stock-consumptions'),{reprojectStockConsumptionOrders}=runtime('workbench-replica/stock-consumption-reproject');const usage=await replaceStockConsumptionSnapshot(q,b.id,b.company_id,rows,m.capturedAt);await reprojectStockConsumptionOrders(q,b.id,usage.affectedOrders);await q.query("SELECT hz_enqueue_relation_root($1,'fulfillment',source_id,order_number) FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])",[b.id,usage.affectedOrders]);await q.query("UPDATE hz_fop_collected_batches SET metadata=metadata-'stockConsumptionSyncError' WHERE id=$1",[b.id]);await q.query('RELEASE SAVEPOINT stock_consumption_capture')}
    catch(error){consumptionIssue=/^[a-z_]+$/.test(error.message)?error.message:'consumption_capture_failed';await q.query('ROLLBACK TO SAVEPOINT stock_consumption_capture');await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{stockConsumptionSyncError}',$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({code:/^[a-z_]+$/.test(error.message)?error.message:'consumption_capture_failed',capturedAt:m.capturedAt})])}
   }
   if(op==='receipt-notice')await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'native_links','receiptLinks','','{}',$2,$3) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=excluded.raw,captured_at=excluded.captured_at WHERE hz_fop_collected_entities.captured_at<=excluded.captured_at`,[b.id,JSON.stringify({values:links,conflicts:[]}),m.capturedAt])
   await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',coalesce(metadata->'entityCaptures','{}')||$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({[{'purchase-requisition':'purchase_application','receipt-notice':'receipt_notice','outbound-list':'outbound'}[op]??op]:{companyId:b.company_id,capturedAt:m.capturedAt,rowCount:saved,coverage:'company_catalogue',complete:true,consistentSnapshot:false}})]);
   await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{authorizedCatalogues}',coalesce(metadata->'authorizedCatalogues','{}')||$2::jsonb) WHERE id=$1",[b.id,JSON.stringify({[op]:{capturedAt:m.capturedAt,rowCount:saved,complete:true,consistentSnapshot:false}})])
   return {operation:op,imported:true,rows:saved,unresolved,...(consumptionIssue?{consumptionIssue}:{})}
  });report.push(result);console.log(JSON.stringify(result));if(!result.consumptionIssue)await remember()
 }}finally{}return report
}
export function catalogFingerprint(rows){const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;const hash=createHash('sha256');for(const row of [...rows].sort((a,b)=>a.id.localeCompare(b.id)))hash.update(JSON.stringify(canonical(row)));return hash.digest('hex')}
async function main(){if(process.argv[2]!=='--execute')throw Error('explicit_execute_required');const c=readSyncConfig(),r=createRequire(resolve('backend/package.json')),db=await new(r('typeorm').DataSource)(syncDatabaseOptions(c)).initialize();try{const report=await importCatalogues({config:c,db,directory:'.runtime/api-20261125/catalog',only:process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',')});writeFileSync('.runtime/api-20261125/catalog-import-result.json',JSON.stringify(report,null,2),{mode:0o600})}finally{await db.destroy()}}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/workbench-authorized-catalog-import.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1})
