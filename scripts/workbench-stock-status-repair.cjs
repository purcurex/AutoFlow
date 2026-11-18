/* Rebuild only stock status projections from already persisted native facts. No FOP calls. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const canonical=x=>x instanceof Date?x.toISOString():Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const fields=['rawOrderStatus','orderStatusName','orderStatus','rawPurchaseStatus','purchaseStatusName','purchaseStatus','paymentStatus','cancelled'];
function patchStockStatus(row,fact,scope){
 const {projectCollectedStockNative}=require('../backend/src/modules/fop-data/collected-stock-native');
 const projected=projectCollectedStockNative(fact,scope.tenant_id,scope.company_id,row);
 if(!projected)throw Error('newer_stock_snapshot_requires_review');
 const display={...row.display,...Object.fromEntries(fields.map(key=>[key,projected[key]]))};
 const missing=new Set(display.dataQuality?.missingFields??[]);
 for(const key of ['orderStatus','purchaseStatus','cancelled'])if(display[key]!=null&&display[key]!=='unknown')missing.delete(key);else missing.add(key);
 display.dataQuality={...display.dataQuality,missingFields:[...missing]};
 return display;
}
module.exports={patchStockStatus};
if(require.main===module)(async()=>{
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true});
 const {parseEnv}=require('node:util'),{Client}=require('pg'),cfg=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'));
 if(cfg.DB_HOST!=='127.0.0.1'||cfg.DB_PORT!=='55432'||cfg.DB_DATABASE!=='autoflow_local_demo'||cfg.FOP_QUERIES_PAUSED!=='true'||cfg.WORKBENCH_SYNC_ENABLED!=='false'||cfg.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('local_paused_database_required');
 const apply=process.argv.includes('--apply'),db=new Client({host:cfg.DB_HOST,port:+cfg.DB_PORT,user:cfg.DB_USERNAME,password:cfg.DB_PASSWORD,database:cfg.DB_DATABASE});
 await db.connect();try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const batches=(await db.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000' FOR UPDATE")).rows;
  if(batches.length!==1)throw Error('unique_active_batch_required');const batch=batches[0];
  const rows=(await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' ORDER BY source_id FOR UPDATE",[batch.id])).rows;
  const facts=(await db.query("SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2 AND entity_type='stock' ORDER BY source_id",[batch.id,batch.company_id])).rows;
  const byId=new Map(facts.map(f=>[f.source_id,f]));
  const updates=rows.map(row=>{const fact=byId.get(row.source_id);if(!fact)throw Error('native_stock_fact_missing');return{row,display:patchStockStatus(row,fact,batch)}}).filter(x=>hash(x.display)!==hash(x.row.display));
  const semantic=updates.filter(x=>x.display.purchaseStatus!==x.row.display.purchaseStatus||x.display.orderStatus!==x.row.display.orderStatus).map(x=>({number:x.row.display.stockNumber,oldOrder:x.row.display.orderStatus,newOrder:x.display.orderStatus,oldPurchase:x.row.display.purchaseStatus,newPurchase:x.display.purchaseStatus,name:x.display.purchaseStatusName}));
  const dir=path.resolve('.runtime/stock-status-20261117');fs.mkdirSync(dir,{recursive:true,mode:0o700});let backup=null;
  if(apply&&updates.length){
   backup=path.join(dir,'before-'+Date.now()+'.json');fs.writeFileSync(backup,JSON.stringify({batchId:batch.id,rows}),{mode:0o600,flag:'wx'});
   const restored=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(hash(restored.rows),hash(rows));
   // Exercise restore payloads in a temporary copy before touching persistent display data.
   await db.query('CREATE TEMP TABLE stock_status_restore_check (source_id text PRIMARY KEY, display jsonb, raw jsonb) ON COMMIT DROP');
   for(const row of restored.rows)await db.query('INSERT INTO stock_status_restore_check VALUES($1,$2,$3)',[row.source_id,JSON.stringify(row.display),JSON.stringify(row.raw)]);
   const restoredRows=(await db.query('SELECT source_id,display,raw FROM stock_status_restore_check ORDER BY source_id')).rows;
   assert.equal(hash(restoredRows),hash(rows.map(({source_id,display,raw})=>({source_id,display,raw}))));
   for(const {row,display} of updates){const r=await db.query("UPDATE hz_fop_collected_entities SET display=$3 WHERE batch_id=$1 AND entity_type='stock_orders' AND source_id=$2 AND display=$4::jsonb",[batch.id,row.source_id,JSON.stringify(display),JSON.stringify(row.display)]);assert.equal(r.rowCount,1)}
   const after=(await db.query("SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' ORDER BY source_id",[batch.id])).rows;
   assert.equal(hash(after.map(({display,...rest})=>rest)),hash(rows.map(({display,...rest})=>rest)));
   for(const row of after)assert.equal(hash(patchStockStatus(row,byId.get(row.source_id),batch)),hash(row.display));
  }
  await db.query(apply?'COMMIT':'ROLLBACK');
  const report={checkedAt:new Date().toISOString(),apply,scanned:rows.length,updated:apply?updates.length:0,planned:updates.length,semanticChanges:semantic,backup,restoreVerified:!!backup,rawAndOtherColumnsUnchanged:true,upstreamCalls:0};
  fs.writeFileSync(path.join(dir,apply?'repair.json':'dry-run.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
