// Offline repair of a previously verified order-list capture. No network calls.
import fs from 'node:fs'
import path from 'node:path'
import {parseEnv} from 'node:util'
import {createHash} from 'node:crypto'
import pg from 'pg'
import {validateMoneyRow} from './workbench-order-money-capture.mjs'

const [directory,mode='--dry-run']=process.argv.slice(2)
if(!directory||!['--dry-run','--apply'].includes(mode))throw Error('capture_directory_and_mode_required')
const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
if(env.DB_HOST!=='127.0.0.1'||env.DB_PORT!=='55432'||env.DB_DATABASE!=='autoflow_local_demo')throw Error('local_target_required')
const db=new pg.Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE})
const pages=fs.readdirSync(directory).filter(file=>/^page-\d+\.json$/.test(file)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0])
const rows=new Map();let total
const evidence=[]
for(const [index,file] of pages.entries()){
 const buffer=fs.readFileSync(path.join(directory,file)),body=JSON.parse(buffer)
 if(body.status!==true||String(body.errorCode)!=='0'||!body.data?.filter?.includes('org in (100000)')||body.data.pageNo!==index+1||!Array.isArray(body.data.rows))throw Error('invalid_saved_page')
 total??=body.data.totalCount
 if(total!==body.data.totalCount)throw Error('inconsistent_saved_total')
 evidence.push({file,sha256:createHash('sha256').update(buffer).digest('hex')})
 for(const row of body.data.rows){if(rows.has(row.id))throw Error('duplicate_source_id');rows.set(row.id,row)}
}
if(!total||rows.size!==total)throw Error('incomplete_saved_capture')
await db.connect()
try{
 const {rows:batches}=await db.query("SELECT id,company_id FROM hz_fop_collected_batches WHERE state='active'")
 if(batches.length!==1||batches[0].company_id!=='100000')throw Error('active_company_required')
 const batch=batches[0]
 const {rows:parents}=await db.query("SELECT source_id,order_number,owner_employee_id,display->'moneyCapture' previous FROM hz_fop_collected_orders WHERE batch_id=$1",[batch.id])
 const changes=[],skipped=[]
 for(const parent of parents){
  const raw=rows.get(parent.source_id),previous=parent.previous
  if(!raw||!previous)continue
  const next=validateMoneyRow(raw,parent,batch.company_id)
  if(previous.sourceId!==next.sourceId||previous.orderNumber!==next.orderNumber||previous.companyId!==next.companyId||previous.operation!=='order-list'||previous.sourceModifiedAt!==next.sourceModifiedAt){skipped.push(parent.order_number);continue}
  const packages=next.values.hzkj_logistics_info
  if(!Array.isArray(packages)||!packages.some(row=>Object.hasOwn(row,'hzkj_channel_name')))continue
  // Only restore the omitted alias into the exact already-imported package facts.
  const withoutNames=packages.map(({hzkj_channel_name,...row})=>row)
  const previousWithoutNames=previous.values?.hzkj_logistics_info?.map(({hzkj_channel_name,...row})=>row)
  if(JSON.stringify(withoutNames)!==JSON.stringify(previousWithoutNames)){skipped.push(parent.order_number);continue}
  if(JSON.stringify(packages)===JSON.stringify(previous.values.hzkj_logistics_info))continue
  const capture={...previous,values:{...previous.values,hzkj_logistics_info:packages}}
  changes.push({parent,capture})
 }
 const report={mode,savedRows:rows.size,changes:changes.length,skipped:skipped.length,knownChannelOrders:changes.filter(x=>x.capture.values.hzkj_logistics_info.some(row=>row.hzkj_channel_name?.trim())).length,upstreamCalled:false}
 if(mode==='--apply'){
  const output=path.join('.runtime','package-channel-restore-'+Date.now());fs.mkdirSync(output,{recursive:true,mode:0o700})
  fs.writeFileSync(path.join(output,'before.json'),JSON.stringify({batch,changes:changes.map(x=>x.parent)}),{mode:0o600})
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify({directory,evidence,skipped}),{mode:0o600})
  await db.query('BEGIN')
  try{
   for(const {parent,capture} of changes){
    const result=await db.query("UPDATE hz_fop_collected_orders SET display=jsonb_set(display,'{moneyCapture}',$5::jsonb) WHERE batch_id=$1 AND source_id=$2 AND order_number=$3 AND owner_employee_id=$4 AND display->'moneyCapture'=$6::jsonb",[batch.id,parent.source_id,parent.order_number,parent.owner_employee_id,JSON.stringify(capture),JSON.stringify(parent.previous)])
    if(result.rowCount!==1)throw Error('local_capture_changed')
   }
   if(changes.length){const result=await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{moneyCaptureUpdatedAt}',to_jsonb($2::text)) WHERE id=$1 AND state='active'",[batch.id,new Date().toISOString()]);if(result.rowCount!==1)throw Error('active_batch_changed')}
   await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});report.evidenceDirectory=output
 }
 console.log(JSON.stringify(report))
}finally{await db.end()}
