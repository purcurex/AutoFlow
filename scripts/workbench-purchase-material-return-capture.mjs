// Explicit read only. --discover obtains stable IDs; --all scans every return API page.
// Legacy candidate enrichment remains available without --all. Automatic calls stay paused.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import { validateMaterialReturnPage } from './material-return-page.mjs'
import { validateAnalyticsPage } from './workbench-analytics-capture.mjs'
import { getToken } from './fop-openapi-smoke.mjs'
import { runQuery } from './fop-workbench-openapi.mjs'
const sha = x => createHash('sha256').update(x).digest('hex')
async function main(){
 const [flag,input,output]=process.argv.slice(2)
 if(flag!=='--authorize-one-shot'||!input||!output)throw Error('directory_and_output_required')
 const cfg=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8')),env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||cfg.FOP_KINGDEE_TENANT_ID!=='hyperzone.test'||cfg.FOP_KINGDEE_ORGANIZATION_IDS!=='100000')throw Error('scope_or_pause_mismatch')
 cfg.FOP_OPENAPI_ACCESS_TOKEN=await getToken({...cfg,FOP_QUERIES_PAUSED:'false'})
 if(input==='--discover'){
  fs.mkdirSync(output,{recursive:true,mode:0o700});const pages=[],seen=new Set();let total,complete=false
  for(let pageNo=1;pageNo<=100;pageNo++){
   const result=await runQuery({...cfg,FOP_QUERIES_PAUSED:'false'},{operation:'inbound',orgNumber:'hyperzone.test',pageNo,pageSize:100,saveResponse:true})
   if(!result.report.success)throw Error(`directory_failed_${result.report.errorCategory}`)
   const d=JSON.parse(result.raw).data
   if(!d.filter.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'"))throw Error('directory_scope')
   total=validateAnalyticsPage(d,pageNo,100,total,seen)
   const file=`page-${String(pageNo).padStart(4,'0')}.json`;fs.writeFileSync(path.join(output,file),result.raw,{mode:0o600,flag:'wx'});pages.push({file,sha256:sha(result.raw),rows:d.rows.length})
   if(d.lastPage){complete=true;break}
  }
  const m={complete,companyId:'100000',context:{tenantId:'hyperzone.test'},capturedAt:new Date().toISOString(),rowCount:seen.size,pages,consistentSnapshot:false}
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600,flag:'wx'});if(!complete)throw Error('directory_page_limit');console.log(JSON.stringify({complete,rows:m.rowCount,pages:pages.length}));return
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8'))
 if(!manifest.complete||manifest.companyId!=='100000'||manifest.context?.tenantId!=='hyperzone.test')throw Error('incomplete_directory')
 const source=[]
 for(const p of manifest.pages){const raw=fs.readFileSync(path.join(input,p.file),'utf8');if(sha(raw)!==p.sha256)throw Error('directory_hash_mismatch');const d=JSON.parse(raw).data;if(!d.filter.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'"))throw Error('directory_scope');source.push(...d.rows)}
 if(source.length!==manifest.rowCount)throw Error('directory_count')
 if(process.argv.includes('--all')){
  fs.mkdirSync(output,{recursive:true,mode:0o700});const pages=[],files=[],seen=new Set();let total,complete=false,returnCount=0,ordinaryCount=0
  const directory=new Map();for(const row of source){if(directory.has(row.billno))throw Error('ambiguous_directory_number');directory.set(row.billno,row)}
  for(let pageNo=1;pageNo<=100;pageNo++){
   const result=await runQuery({...cfg,FOP_QUERIES_PAUSED:'false'},{operation:'purchase-material-return',pageNo,pageSize:100,saveResponse:true})
   if(!result.report.success)throw Error(`return_page_failed_${result.report.errorCategory}`)
   const d=JSON.parse(result.raw).data
   if(!d.filter.includes('org in (100000)'))throw Error('return_scope')
   total=validateMaterialReturnPage(d,pageNo,100,total,seen)
   const pageFile=`page-${String(pageNo).padStart(4,'0')}.json`;fs.writeFileSync(path.join(output,pageFile),result.raw,{mode:0o600,flag:'wx'});pages.push({file:pageFile,sha256:sha(result.raw),rows:d.rows.length})
   for(const detail of d.rows){
    if(!['标准采购退料单','采购退料单','采购退料'].includes(detail.billtype_name)){ordinaryCount++;continue}
    const origin=directory.get(detail.billno);if(!origin)throw Error('return_directory_id_missing')
    const raw=JSON.stringify({directory:origin,detail}),file=`${origin.id}.json`
    fs.writeFileSync(path.join(output,file),raw,{mode:0o600,flag:'wx'});files.push({file,sha256:sha(raw)});returnCount++
   }
   if(d.lastPage){complete=true;break}
  }
  const m={companyId:'100000',tenantId:'hyperzone.test',capturedAt:new Date().toISOString(),complete,coverage:'all-material-return-api-pages',consistentSnapshot:false,apiRows:seen.size,returnCount,ordinaryCount,pages,files}
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600,flag:'wx'});if(!complete)throw Error('return_page_limit');console.log(JSON.stringify({...m,pages:pages.length,files:files.length}));return
 }
 const candidates=source.filter(r=>r.billentry?.some(l=>['1','2'].includes(String(l.returnmaterialtype))||typeof l.qty==='number'&&l.qty<0))
 fs.mkdirSync(output,{recursive:true,mode:0o700});const captures=[]
 for(const r of candidates){
  const result=await runQuery({...cfg,FOP_QUERIES_PAUSED:'false'},{operation:'purchase-material-return',billno:r.billno,pageNo:1,pageSize:100,saveResponse:true})
  if(!result.report.success)throw Error(`detail_failed_${result.report.errorCategory}`)
  const body=JSON.parse(result.raw)
  if(body.data.rows.length!==1||!body.data.lastPage||!body.data.filter.includes('org in (100000)'))throw Error('ambiguous_detail')
  const raw=JSON.stringify({directory:r,detail:body.data.rows[0]}),file=`${r.id}.json`
  fs.writeFileSync(path.join(output,file),raw,{mode:0o600});captures.push({file,sha256:sha(raw)})
 }
 const m={companyId:'100000',tenantId:'hyperzone.test',capturedAt:new Date().toISOString(),directoryRows:source.length,candidateCount:candidates.length,complete:true,coverage:'return-type-or-negative-quantity-candidates',files:captures}
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600});console.log(JSON.stringify({...m,files:captures.length}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
