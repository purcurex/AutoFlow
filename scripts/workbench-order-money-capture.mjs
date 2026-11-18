#!/usr/bin/env node
// Explicit targeted read-only capture. Never changes FOP business state or automatic sync switches.
import fs from 'node:fs'
import path from 'node:path'
import {parseEnv} from 'node:util'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {runQuery} from './fop-workbench-openapi.mjs'
export const fields=['hzkj_total_amount','hzkj_order_amount','hzkj_fre_quo_amount','hzkj_fixed_tax_fee','hzkj_discount_cost']
export function validateMoneyDetail(body,parent,companyId){
 if(body.status!==true||String(body.errorCode)!=='0'||!body.data?.filter?.includes(`org in (${companyId})`)||body.data.totalCount!==1||body.data.rows?.length!==1)throw Error('unverified_detail_scope')
 return validateMoneyRow(body.data.rows[0],parent,companyId,'order-detail')
}
export function validateMoneyRow(r,parent,companyId,operation='order-list'){
 if(!['order-list','order-detail'].includes(operation))throw Error('invalid_operation')
 if(r.id!==parent.source_id||r.billno!==parent.order_number||r.hzkj_operator_id!==parent.owner_employee_id)throw Error('order_identity_changed')
 const values={}
 for(const key of fields)if(Object.hasOwn(r,key)){
  const v=r[key];if(v!==null&&(!['string','number'].includes(typeof v)||!/^-?\d+(\.\d+)?$/.test(String(v))))throw Error('invalid_money')
  values[key]=v
 }
 if(Object.hasOwn(r,'hzkj_logistics_info')&&r.hzkj_logistics_info===null)values.hzkj_logistics_info=null
 if(Object.hasOwn(r,'hzkj_logistics_info')&&r.hzkj_logistics_info!==null){
  if(!Array.isArray(r.hzkj_logistics_info))throw Error('invalid_packages')
  values.hzkj_logistics_info=r.hzkj_logistics_info.map(row=>{
   if(!row||typeof row!=='object')throw Error('invalid_package')
   const value=row.hzkj_package_tax_fee
   if(value!=null&&(!['string','number'].includes(typeof value)||!/^\d+(\.\d+)?$/.test(String(value))))throw Error('invalid_package_tax')
   if(Object.hasOwn(row,'hzkj_channel_name')&&row.hzkj_channel_name!==null&&typeof row.hzkj_channel_name!=='string')throw Error('invalid_package_channel_name')
   if(Object.hasOwn(row,'hzkj_tracking_number')&&row.hzkj_tracking_number!==null&&typeof row.hzkj_tracking_number!=='string')throw Error('invalid_package_tracking_number')
   return Object.fromEntries(['id','hzkj_combofield','hzkj_package_tax_fee','hzkj_channel_name','hzkj_tracking_number'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))
  })
 }
 return {sourceId:r.id,orderNumber:r.billno,companyId,operation,capturedAt:new Date().toISOString(),sourceModifiedAt:r.modifytime??null,values,missingFields:fields.filter(k=>!Object.hasOwn(values,k)),complete:fields.every(k=>values[k]!=null)}
}
async function main(){
 const a=process.argv.slice(2)
 if(a.length!==3||a[0]!=='--authorize-one-shot'||a[1]!=='--limit'||!/^\d+$/.test(a[2])||+a[2]<1||+a[2]>100)throw Error('explicit_limit_1_to_100_required')
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),cfg=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'))
 if(env.DB_DATABASE!=='autoflow_local_demo'||env.DB_PORT!=='55432'||!['127.0.0.1','localhost'].includes(env.DB_HOST)||env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_SYNC_ENABLED!=='false'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||cfg.FOP_KINGDEE_TENANT_ID!=='hyperzone.test'||cfg.FOP_KINGDEE_ORGANIZATION_IDS!=='100000')throw Error('unconfirmed_target')
 const require=createRequire(import.meta.url),{Client}=require('pg'),db=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE})
 await db.connect()
 const dir=path.resolve('.runtime/order-money-capture/run-'+Date.now());fs.mkdirSync(dir,{recursive:true,mode:0o700})
 try{
  const {rows:batches}=await db.query("SELECT id,company_id FROM hz_fop_collected_batches WHERE state='active' AND company_id='100000'")
  if(batches.length!==1)throw Error('one_active_batch_required');const batch=batches[0]
  const {rows}=await db.query("SELECT source_id,order_number,owner_employee_id,display->'moneyCapture' previous FROM hz_fop_collected_orders WHERE batch_id=$1 AND raw_order_status IN ('0','1') AND total_amount IS NULL AND coalesce(display->'moneyCapture'->>'complete','false')<>'true' ORDER BY source_id LIMIT $2",[batch.id,+a[2]])
  fs.writeFileSync(path.join(dir,'before.json'),JSON.stringify({batch,rows}),{mode:0o600})
  const reports=[]
  for(const parent of rows){
   const r=await runQuery({...cfg,FOP_QUERIES_PAUSED:'false'},{operation:'order-detail',id:parent.source_id,pageNo:1,pageSize:10,saveResponse:true})
   if(!r.report.success||!r.raw)throw Error('detail_query_failed')
   fs.writeFileSync(path.join(dir,parent.source_id+'.json'),r.raw,{mode:0o600})
   const capture=validateMoneyDetail(JSON.parse(r.raw),parent,batch.company_id)
   // Preserve the original capture; only the independent monetary supplement changes.
   await db.query('BEGIN')
   try{
    const result=await db.query("UPDATE hz_fop_collected_orders o SET display=jsonb_set(display,'{moneyCapture}',$5::jsonb) WHERE batch_id=$1 AND source_id=$2 AND order_number=$3 AND owner_employee_id=$4 AND EXISTS(SELECT 1 FROM hz_fop_collected_batches b WHERE b.id=o.batch_id AND b.state='active') RETURNING source_id",[batch.id,parent.source_id,parent.order_number,parent.owner_employee_id,JSON.stringify(capture)])
    if(result.rowCount!==1)throw Error('local_order_changed')
    await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{moneyCaptureUpdatedAt}',to_jsonb($2::text)) WHERE id=$1",[batch.id,capture.capturedAt]);await db.query('COMMIT')
   }catch(e){await db.query('ROLLBACK');throw e}
   reports.push({orderNumber:parent.order_number,complete:capture.complete,providedFields:Object.keys(capture.values),missingFields:capture.missingFields})
  }
  const report={captured:reports.length,reports,upstreamCalled:true,automaticSyncEnabled:false};fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))
 }finally{await db.end()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^[a-z_0-9]+$/.test(e.message)?e.message:'money_capture_failed; inspect private capture files');process.exitCode=1})
