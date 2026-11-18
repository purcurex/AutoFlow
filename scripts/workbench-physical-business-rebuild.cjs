#!/usr/bin/env node
// Rebuild local derived facts only. Source/raw and remote FOP are never mutated.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});
const {physicalBusinessProjection}=require('../backend/src/modules/fop-data/physical-business-projection');
const {withVirtualProductFacts}=require('../backend/src/modules/fop-data/physical-business-lines');
const {projectPurchaseOrderRows,purchaseSalesReference}=require('../backend/src/modules/fop-data/collected-purchase-association');
const {scopedPurchaseGroup}=require('../backend/src/modules/fop-data/collected-native-facts');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
async function rebuildPhysicalBusiness(db,batch,{write=false,backup}={}){
 const report={orders:0,changedOrders:0,changedBusinessStatuses:0,changedQueueFlags:0,purchases:0,changedPurchases:0,virtualOrders:0,fopRequests:0,businessChanges:[],unchangedExceptionChecksSkipped:0};
 // The repair changes display projections only. Preserve work already enqueued
 // by this transaction and every parent whose purchase projection changes.
 const protectedIds=new Set(write?(await db.query("SELECT source_id FROM hz_fop_exception_dirty WHERE batch_id=$1 AND transaction_id=txid_current() AND document_kind='order'",[batch])).map(r=>r.source_id):[]);
 const entities=await db.query('SELECT source_id,entity_type,raw,display FROM hz_fop_collected_entities WHERE batch_id=$1',[batch]);
 const products=new Map(entities.filter(e=>e.entity_type==='product').map(e=>[e.source_id,e.raw]));
 const purchases=entities.filter(e=>e.entity_type==='purchase'),parents=new Map(),byId=new Map();
 const numbers=[...new Set(purchases.flatMap(p=>(p.raw.hzkj_billentry??[]).map(l=>purchaseSalesReference(l).number)).filter(Boolean))];
 for(let i=0;i<numbers.length;i+=250)for(const o of await db.query('SELECT source_id,order_number,raw,display FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])',[batch,numbers.slice(i,i+250)])){
  parents.set(o.order_number,parents.has(o.order_number)?null:withVirtualProductFacts(o.raw,id=>products.get(id)));byId.set(o.source_id,o.display);
 }
 const byParent=new Map();
 for(const p of purchases){
  report.purchases++;
  if(!p.raw.versions&&p.display.association?.state!=='conflict'){
   const projected=projectPurchaseOrderRows(p.raw,n=>parents.get(n),id=>byId.get(id));
   const display=scopedPurchaseGroup({...p.display,rows:projected.rows,association:{...p.display.association,state:projected.unresolved?'partial':'verified',unresolvedLineCount:projected.unresolved}},null);
   if(canonical(display)!==canonical(p.display)){
    report.changedPurchases++;
    for(const row of [...(p.display.rows??[]),...(display.rows??[])])if(row.orderId)protectedIds.add(row.orderId);
    if(write){if(!backup)throw Error('backup_required');backup({entity:'purchase',id:p.source_id,display:p.display});await db.query("UPDATE hz_fop_collected_entities SET display=$3 WHERE batch_id=$1 AND entity_type='purchase' AND source_id=$2",[batch,p.source_id,JSON.stringify(display)])}
    p.display=display;
   }
  }
  for(const id of new Set((p.display.rows??[]).map(r=>r.orderId).filter(Boolean))){if(!byParent.has(id))byParent.set(id,[]);byParent.get(id).push(p)}
 }
 const apps=new Map();for(const e of entities.filter(e=>e.entity_type==='purchase_application'))for(const n of new Set((e.raw.entryentity??[]).map(l=>l.hzkj_srcbillnumber).filter(Boolean))){if(!apps.has(n))apps.set(n,[]);apps.get(n).push(e.raw)}
 let cursor='';
 while(true){
  const rows=await db.query('SELECT source_id,raw,display,is_exception FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id>$2 ORDER BY source_id LIMIT 250',[batch,cursor]);if(!rows.length)break;
  const updates=[],unchangedExceptionIds=[];
  for(const o of rows){
   report.orders++;const display=physicalBusinessProjection(o.raw,o.display,products,byParent.get(o.source_id)??[],apps.get(o.raw.billno)??[]);
   if(display.items.some(i=>i.isVirtual))report.virtualOrders++;
   if(canonical(display.businessStatus)!==canonical(o.display.businessStatus)){report.changedBusinessStatuses++;report.businessChanges.push({orderNumber:o.raw.billno,before:o.display.businessStatus,after:display.businessStatus})}
   if(canonical(display.procurementQueueFlags)!==canonical(o.display.procurementQueueFlags))report.changedQueueFlags++;
   if(canonical(display)!==canonical(o.display)){report.changedOrders++;updates.push({id:o.source_id,display});if(write)backup({entity:'order',id:o.source_id,display:o.display});
    if(!protectedIds.has(o.source_id)&&!exceptionNeedsRecheck(o,display))unchangedExceptionIds.push(o.source_id);
   }
  }
  if(write&&updates.length)await db.query('UPDATE hz_fop_collected_orders o SET display=x.display FROM jsonb_to_recordset($2::jsonb) x(id text,display jsonb) WHERE o.batch_id=$1 AND o.source_id=x.id',[batch,JSON.stringify(updates)]);
  if(write&&unchangedExceptionIds.length)await db.query("DELETE FROM hz_fop_exception_dirty WHERE batch_id=$1 AND transaction_id=txid_current() AND document_kind='order' AND source_id=ANY($2::text[])",[batch,unchangedExceptionIds]);
  report.unchangedExceptionChecksSkipped+=unchangedExceptionIds.length;
  cursor=rows.at(-1).source_id;
 }
 return report;
}
function exceptionNeedsRecheck(before,after){
 if(before.is_exception||(before.display.items??[]).some(i=>i.isVirtual)||(after.items??[]).some(i=>i.isVirtual))return true;
 // All remaining exception inputs (source/raw, allocation, dispatch, money and
 // payment captures) are unchanged by this offline projection. If a future
 // projector changes another field, conservatively recheck that order.
 const irrelevant=new Set(['items','fulfillmentProgress','nativeFulfillmentProgress','timestampProjection']);
 for(const k of new Set([...Object.keys(before.display),...Object.keys(after)]))if(!irrelevant.has(k)&&canonical(before.display[k])!==canonical(after[k]))return true;
 return false;
}
module.exports={rebuildPhysicalBusiness,exceptionNeedsRecheck};
if(require.main===module)(async()=>{
 const apply=process.argv.includes('--apply');if(!apply&&!process.argv.includes('--dry-run'))throw Error('explicit_mode_required');
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'));
 if(env.DB_HOST!=='127.0.0.1'||env.DB_PORT!=='55432'||env.DB_DATABASE!=='autoflow_local_demo'||env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('paused_local_database_required');
 const {Client}=require('pg'),client=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});await client.connect();const db={query:async(sql,params)=>(await client.query(sql,params)).rows};
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  if(apply&&!(await db.query("SELECT 1 FROM pg_proc WHERE proname='hz_exception_evaluate_order_v5'")).length)throw Error('physical_business_migration_required');
  const batches=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000' FOR UPDATE");if(batches.length!==1)throw Error('unique_active_batch_required');
  let backup;if(apply){const file=path.resolve('.runtime/physical-business-before-'+Date.now()+'.jsonl');fs.writeFileSync(file,'',{mode:0o600,flag:'wx'});backup=r=>fs.appendFileSync(file,JSON.stringify({...r,batchId:batches[0].id})+'\n');}
  const report=await rebuildPhysicalBusiness(db,batches[0].id,{write:apply,backup});await db.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify(report));
 }catch(e){await db.query('ROLLBACK');throw e}finally{await client.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
