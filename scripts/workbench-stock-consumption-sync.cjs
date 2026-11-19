/** Read-only FOP capture; --apply publishes local facts transactionally. No FOP business writes. */
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util')
const {DataSource}=require('typeorm')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.runtime/stock-consumption-20261118')
const args=process.argv.slice(2),apply=args.includes('--apply'),fileIndex=args.indexOf('--capture-file')
if(args.some((x,i)=>!['--apply','--capture-file'].includes(x)&&i!==(fileIndex>=0?fileIndex+1:-1)))throw Error('invalid_arguments')
async function main(){
 fs.mkdirSync(output,{recursive:true,mode:0o700})
 const env=parseEnv(fs.readFileSync(path.join(root,'backend/.env.workbench.local'),'utf8'))
 const config={...parseEnv(fs.readFileSync(path.join(root,'backend/.env.fop.local'),'utf8')),...process.env}
 if(config.NODE_ENV==='production'||config.WORKBENCH_TIMESTAMP_ENVIRONMENT==='production')throw Error('use_verified_production_capture_configuration')
 const pause=path.join(root,'backend/.env.fop-pause');if(fs.existsSync(pause)&&parseEnv(fs.readFileSync(pause,'utf8')).FOP_QUERIES_PAUSED==='true')throw Error('fop_queries_paused')
 const {normalizeStockConsumptions}=require('../backend/dist/src/modules/fop-data/stock-consumption-source')
 const {replaceStockConsumptionSnapshot}=require('../backend/dist/src/modules/workbench-replica/collected-stock-consumptions')
 const {reprojectStockConsumptionOrders}=require('../backend/dist/src/modules/workbench-replica/stock-consumption-reproject')
 const {assertCompanyConjunction}=require('../backend/dist/src/modules/workbench-replica/timestamp-paged-source')
 let capture
 if(fileIndex>=0){capture=JSON.parse(fs.readFileSync(path.resolve(args[fileIndex+1]),'utf8'))}
 else{
  const {runQuery}=await import('./fop-workbench-openapi.mjs'),{getToken}=await import('./fop-openapi-smoke.mjs'),rows=[],seen=new Set(),pageSize=5;let total,finished=false
  for(let page=1;page<=1000;page++){
   if(!config.FOP_OPENAPI_ACCESS_TOKEN)config.FOP_OPENAPI_ACCESS_TOKEN=await getToken(config)
   let r=await runQuery(config,{operation:'stock',orgNumber:'hyperzone.test',pageNo:page,pageSize,saveResponse:true})
   if(!r.report.success&&r.report.errorCategory==='authentication-error'){delete config.FOP_OPENAPI_ACCESS_TOKEN;config.FOP_OPENAPI_ACCESS_TOKEN=await getToken(config);r=await runQuery(config,{operation:'stock',orgNumber:'hyperzone.test',pageNo:page,pageSize,saveResponse:true})}
   if(!r.report.success||!r.raw)throw Error('stock_capture_'+r.report.errorCategory)
   const d=JSON.parse(r.raw).data;assertCompanyConjunction(d.filter,'100000','hyperzone.test')
   if(!Number.isSafeInteger(d.totalCount)||d.totalCount<0||d.pageNo!==page||d.pageSize!==pageSize||typeof d.lastPage!=='boolean'||total!==undefined&&total!==d.totalCount)throw Error('stock_capture_paging_changed')
   total=d.totalCount
   if(page===1||page%10===0||d.lastPage)console.error(JSON.stringify({capturePage:page,pages:Math.ceil(total/pageSize)}))
   for(const row of r.rows){if(row.org_id!=='100000'||seen.has(row.id))throw Error('stock_capture_identity_conflict');seen.add(row.id);rows.push(row)}
   if(d.lastPage){finished=true;break}if(r.rows.length!==pageSize)throw Error('stock_capture_short_page')
   await new Promise(resolve=>setTimeout(resolve,500))
  }
  if(!finished||rows.length!==total)throw Error('stock_capture_incomplete')
  capture={companyId:'100000',tenantId:'hyperzone.test',complete:true,capturedAt:new Date().toISOString(),rows}
  fs.writeFileSync(path.join(output,'capture.json'),JSON.stringify(capture),{mode:0o600})
 }
 if(capture.companyId!=='100000'||capture.tenantId!=='hyperzone.test'||capture.complete!==true||!Array.isArray(capture.rows))throw Error('capture_scope_invalid')
 const records=normalizeStockConsumptions(capture.rows,'100000')
 const report={applied:false,stockCount:capture.rows.length,recordCount:records.length,missingSkuCount:records.filter(r=>!r.skuId).length,byType:{full:records.filter(r=>r.stockType==='1').length,deposit:records.filter(r=>r.stockType==='2').length},byStatus:{reserved:records.filter(r=>r.status==='0').length,used:records.filter(r=>r.status==='1').length}}
 if(apply){
  const db=new DataSource({type:'postgres',host:env.DB_HOST,port:+env.DB_PORT,username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,synchronize:false});await db.initialize()
  try{await db.transaction(async q=>{
   const batches=await q.query("SELECT * FROM hz_fop_collected_batches WHERE state='active' AND tenant_id='hyperzone.test' AND company_id='100000' FOR UPDATE")
   if(batches.length!==1)throw Error('active_batch_ambiguous');const batch=batches[0]
   const oldConsumptions=await q.query('SELECT * FROM hz_fop_collected_stock_consumptions WHERE batch_id=$1',[batch.id])
   const result=await replaceStockConsumptionSnapshot(q,batch.id,'100000',capture.rows,capture.capturedAt)
   if(result.changed){const previous=await q.query('SELECT source_id,display FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=ANY($2::text[])',[batch.id,result.affectedOrders]);fs.writeFileSync(path.join(output,'before-'+Date.now()+'.json'),JSON.stringify({batchId:batch.id,metadata:batch.metadata,orders:previous,consumptions:oldConsumptions}),{mode:0o600})}
   const changedOrders=await reprojectStockConsumptionOrders(q,batch.id,result.affectedOrders)
   Object.assign(report,{applied:true,batchId:batch.id,changedOrders,revision:result.revision,changed:result.changed})
  })}finally{await db.destroy()}
 }
 fs.writeFileSync(path.join(output,apply?'applied.json':'dry-run.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
