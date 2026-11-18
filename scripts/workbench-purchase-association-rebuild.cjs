#!/usr/bin/env node
// Explicit local projection rebuild; never contacts FOP or changes captured raw documents.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});
const {Client}=require('pg'),{projectPurchaseOrderRows,purchaseGroupFacts}=require('../backend/src/modules/fop-data/collected-purchase-association'),{scopedPurchaseGroup}=require('../backend/src/modules/fop-data/collected-native-facts'),{timestampProcurementProjection}=require('../backend/src/modules/workbench-replica/timestamp-procurement-projection');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
async function main(){
 const apply=process.argv.includes('--apply');if(!apply&&!process.argv.includes('--dry-run'))throw Error('explicit_mode_required');
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'));
 if(e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='55432'||e.DB_DATABASE!=='autoflow_local_demo'||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false')throw Error('paused_local_database_required');
 const db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect();
 const report={apply,groups:0,changedGroups:0,verifiedRows:0,unresolvedRows:0,lineIdentityMissing:0,orders:0,changedOrders:0,stages:{},fopRequests:0};
 try{
  await db.query(apply?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:batches}=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000'"+(apply?' FOR UPDATE':''));if(batches.length!==1)throw Error('unique_active_batch_required');const batch=batches[0].id;
  const fingerprint=async()=>(await db.query(`SELECT md5(string_agg(h,'|' ORDER BY k)) hash FROM (SELECT 'o:'||source_id k,md5(raw::text) h FROM hz_fop_collected_orders WHERE batch_id=$1 UNION ALL SELECT entity_type||':'||source_id,md5(raw::text) FROM hz_fop_collected_entities WHERE batch_id=$1) t`,[batch])).rows[0].hash;
  const before=await fingerprint();let backup;
  if(apply){fs.mkdirSync('.runtime/purchase-association',{recursive:true});backup=`.runtime/purchase-association/before-${Date.now()}.jsonl`;fs.writeFileSync(backup,JSON.stringify({batchId:batch,rawFingerprint:before})+'\n',{mode:0o600,flag:'wx'});report.backup=backup}
  const purchases=(await db.query("SELECT source_id,raw,display,search_text FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' ORDER BY source_id",[batch])).rows;
  const numbers=[...new Set(purchases.flatMap(p=>(p.raw.hzkj_billentry??[]).flatMap(l=>[l.hzkj_srcbillnumber,l.hzkj_salbillnumber])).filter(Boolean))];
  const parents=new Map(),parentDisplays=new Map();for(let i=0;i<numbers.length;i+=250){for(const r of (await db.query('SELECT order_number,raw,display FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])',[batch,numbers.slice(i,i+250)])).rows){parents.set(r.order_number,parents.has(r.order_number)?null:r.raw);parentDisplays.set(r.raw.id,r.display)}}
  const byParent=new Map();
  for(const p of purchases){
   report.groups++;if(p.raw.versions||p.display.association?.state==='conflict')continue;
   const projected=projectPurchaseOrderRows(p.raw,n=>parents.get(n),id=>parentDisplays.get(id));
   const display=scopedPurchaseGroup({...p.display,...purchaseGroupFacts(p.raw,projected.rows,projected.unresolved),rows:projected.rows,association:{...p.display.association,state:projected.unresolved?'partial':'verified',unresolvedLineCount:projected.unresolved}},null);
   for(const row of display.rows){if(row.orderId){report.verifiedRows++;if(!byParent.has(row.orderId))byParent.set(row.orderId,[]);byParent.get(row.orderId).push({raw:p.raw,display});}else report.unresolvedRows++;report.lineIdentityMissing+=row.lines.filter(l=>!l.fulfillmentLineId).length}
   if(canonical(display)!==canonical(p.display)){report.changedGroups++;if(apply){fs.appendFileSync(backup,JSON.stringify({entity:'purchase',id:p.source_id,display:p.display,searchText:p.search_text})+'\n');await db.query("UPDATE hz_fop_collected_entities SET display=$3,search_text=$4 WHERE batch_id=$1 AND entity_type='purchase' AND source_id=$2",[batch,p.source_id,JSON.stringify(display),JSON.stringify(display).toLowerCase()])}}
  }
  const applicationsByNumber=new Map();for(const e of (await db.query("SELECT raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase_application'",[batch])).rows)for(const n of new Set((e.raw.entryentity??[]).map(l=>l.hzkj_srcbillnumber).filter(Boolean))){if(!applicationsByNumber.has(n))applicationsByNumber.set(n,[]);applicationsByNumber.get(n).push(e.raw)}
  let cursor='';while(true){
   const rows=(await db.query('SELECT source_id,display,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id>$2 ORDER BY source_id LIMIT 250',[batch,cursor])).rows;if(!rows.length)break;
   const updates=[];for(const r of rows){report.orders++;const patch=timestampProcurementProjection(r.raw,byParent.get(r.source_id)??[],applicationsByNumber.get(r.raw.billno)??[],r.display.dispatchDocuments),display={...r.display,...patch};report.stages[patch.procurementStage]=(report.stages[patch.procurementStage]??0)+1;
    if(Object.keys(patch).some(k=>canonical(patch[k])!==canonical(r.display[k]))){report.changedOrders++;updates.push({id:r.source_id,display});if(apply)fs.appendFileSync(backup,JSON.stringify({entity:'order',id:r.source_id,display:r.display})+'\n')}
   }
   if(apply&&updates.length)await db.query('UPDATE hz_fop_collected_orders o SET display=x.display FROM jsonb_to_recordset($2::jsonb) x(id text,display jsonb) WHERE o.batch_id=$1 AND o.source_id=x.id',[batch,JSON.stringify(updates)]);
   cursor=rows.at(-1).source_id;
  }
  report.rawUnchanged=(await fingerprint())===before;if(!report.rawUnchanged)throw Error('raw_changed');
  await db.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify(report));
 }catch(error){await db.query('ROLLBACK');throw error}finally{await db.end()}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
