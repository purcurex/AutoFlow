#!/usr/bin/env node
// Offline same-document projection. No FOP calls, raw rewrites or business transitions.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util')
async function refreshSalesSourcePaymentStatuses(db,batchId,{dryRun=false,backupFile}={}){
 const {salesSourcePaymentStatusFromCapture}=require('../backend/src/modules/workbench-replica/collected-sales-source-status')
 const [batch]=await db.query('SELECT id,company_id,source_as_of,metadata FROM hz_fop_collected_batches WHERE id=$1 FOR UPDATE',[batchId])
 if(!batch)throw Error('active_batch_required')
 const rows=await db.query(`SELECT o.source_id AS "sourceId",o.order_number AS "orderNumber",o.raw_order_status AS "orderStatus",
  jsonb_exists(o.raw,'hzkj_sourcepayststus') AS "hasOwnSourceStatus",o.display->'salesSourcePaymentStatus' AS previous,
  CASE WHEN a.source_id IS NOT NULL THEN jsonb_build_object('sourceId',a.source_id,'orderNumber',a.document_number,
   'orderStatus',a.raw->>'hzkj_orderstatus','companyId',a.company_id,'scopeVerified',a.facts->'scope'->'verified',
   'hasSourceStatus',jsonb_exists(a.raw,'hzkj_sourcepayststus'),'sourceStatus',a.raw->>'hzkj_sourcepayststus',
   'capturedAt',a.captured_at) END AS capture
  FROM hz_fop_collected_orders o LEFT JOIN hz_fop_collected_analytics_facts a
   ON a.batch_id=o.batch_id AND a.entity_type='fulfillment' AND a.source_id=o.source_id AND a.company_id=$2
  WHERE o.batch_id=$1`,[batchId,batch.company_id])
 const primary=new Date(batch.source_as_of).toISOString()
 const projected=rows.map(r=>({sourceId:r.sourceId,status:salesSourcePaymentStatusFromCapture({...r,companyId:batch.company_id,batchSourceAsOf:primary})}))
 const report={orders:rows.length,supplemented:projected.filter(r=>r.status!==null).length,
  sourcePaymentExcluded:projected.filter(r=>['refunded','voided','expired','unpaid'].includes(r.status?.paymentStatus)).length,dryRun,upstreamCalled:false}
 if(dryRun)return report
 if(backupFile)fs.writeFileSync(backupFile,JSON.stringify({batchId,metadata:batch.metadata,rows:rows.map(r=>({sourceId:r.sourceId,previous:r.previous}))}),{mode:0o600,flag:'wx'})
 let changed=0
 for(let i=0;i<projected.length;i+=500){
  const updates=await db.query(`UPDATE hz_fop_collected_orders o SET display=CASE WHEN x.status IS NULL
    THEN o.display-'salesSourcePaymentStatus' ELSE jsonb_set(o.display,'{salesSourcePaymentStatus}',x.status) END
    FROM jsonb_to_recordset($2::jsonb) x("sourceId" text,status jsonb)
    WHERE o.batch_id=$1 AND o.source_id=x."sourceId" AND coalesce(o.display->'salesSourcePaymentStatus','null'::jsonb) IS DISTINCT FROM coalesce(x.status,'null'::jsonb)
    RETURNING o.source_id`,[batchId,JSON.stringify(projected.slice(i,i+500))]);changed+=updates.length
 }
 if(changed)await db.query(`UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures}',
   coalesce(metadata->'entityCaptures','{}'::jsonb)||$2::jsonb) WHERE id=$1`,[batchId,JSON.stringify({salesSourcePaymentStatus:{
    coverage:'local_same_document_projection',ruleVersion:1,rebuiltAt:new Date().toISOString(),companyId:batch.company_id,
    rowCount:report.supplemented,sourceCapture:batch.metadata?.analyticsCaptures?.fulfillment??null}})])
 return {...report,changed}
}
async function main(){
 const args=process.argv.slice(2)
 if(args.length!==1||!['--dry-run','--apply'].includes(args[0]))throw Error('use --dry-run or --apply')
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(e.DB_DATABASE!=='autoflow_local_demo'||e.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(e.DB_HOST)
  ||e.FOP_QUERIES_PAUSED!=='true'||e.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||e.WORKBENCH_SYNC_ENABLED!=='false')throw Error('explicit_paused_local_target_required')
 require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
 const {Client}=require('pg'),client=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE})
 await client.connect()
 try{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='30s'")
  const db={query:async(s,p)=>(await client.query(s,p)).rows}
  const batches=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000'")
  if(batches.length!==1)throw Error('one_active_local_company_required')
  const dryRun=args[0]==='--dry-run',backupDir=path.resolve('.runtime/sales-source-payment-status')
  if(!dryRun)fs.mkdirSync(backupDir,{recursive:true,mode:0o700})
  const report=await refreshSalesSourcePaymentStatuses(db,batches[0].id,{dryRun,backupFile:dryRun?undefined:path.join(backupDir,`before-${Date.now()}.json`)})
  await client.query(dryRun?'ROLLBACK':'COMMIT');console.log(JSON.stringify(report))
 }catch(e){await client.query('ROLLBACK');throw e}finally{await client.end()}
}
module.exports={refreshSalesSourcePaymentStatuses}
if(require.main===module)main().catch(()=>{console.error('sales_source_payment_status_projection_failed; transaction rolled back, no upstream queries');process.exitCode=1})
