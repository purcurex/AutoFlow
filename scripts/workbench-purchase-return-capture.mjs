#!/usr/bin/env node
// Explicit one-shot read of the supplied refund-candidate API. Never a physical-return importer.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runQuery } from './fop-workbench-openapi.mjs'
import { getToken } from './fop-openapi-smoke.mjs'
import { validateAnalyticsPage } from './workbench-analytics-capture.mjs'
import { normalizePurchaseRefundCandidate, physicalPurchaseReturnGap } from './fop-purchase-refund-facts.mjs'
const sha = s => createHash('sha256').update(s).digest('hex')
export async function capturePurchaseRefundCandidates({directory,context,query}) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700})
 const m={version:1,captureId:randomUUID(),operation:'queryPurchaseReturn',sourceEntity:'hzkj_purorderbill',semanticType:'purchase_refund_candidates',physicalReturnIntegration:false,context,companyId:'100000',orgNumber:'hyperzone.test',capturedAt:new Date().toISOString(),consistentSnapshot:false,complete:false,rowCount:0,pages:[]}
 let total;const seen=new Set(),candidates=[]
 try {
  for(let pageNo=1;pageNo<=20;pageNo++){
   const r=await query({operation:'purchase-return',orgNumber:m.orgNumber,pageNo,pageSize:100,saveResponse:true})
   if(!r.report.success||typeof r.raw!=='string'){m.sourceFailure={httpStatus:r.report.httpStatus??null,category:r.report.errorCategory??'invalid_response',pageNo};throw Error('source_query_failed')}
   const body=JSON.parse(r.raw),file=`page-${String(pageNo).padStart(4,'0')}.json`
   fs.writeFileSync(path.join(directory,file),r.raw,{mode:0o600,flag:'wx'})
   total=validateAnalyticsPage(body.data,pageNo,100,total,seen)
   candidates.push(...body.data.rows.map(normalizePurchaseRefundCandidate))
   m.pages.push({file,sha256:sha(r.raw),rows:body.data.rows.length});m.rowCount=seen.size
   if(body.data.lastPage){m.complete=true;break}
  }
  if(!m.complete)throw Error('page_limit')
  const normalized=JSON.stringify({version:1,companyId:m.companyId,capturedAt:m.capturedAt,consistentSnapshot:false,...physicalPurchaseReturnGap,items:candidates},null,2)
  fs.writeFileSync(path.join(directory,'refund-candidates.json'),normalized,{mode:0o600,flag:'wx'})
  m.normalized={file:'refund-candidates.json',sha256:sha(normalized),rows:candidates.length,semanticType:'purchase_refund_candidates'}
 }catch(e){m.complete=false;m.error=/^[a-z_]+$/.test(e.message)?e.message:'capture_failed'}
 m.finishedAt=new Date().toISOString()
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600,flag:'wx'})
 return m
}
async function main(){
 const args=process.argv.slice(2)
 if(args.length!==3||args[0]!=='--authorize-one-shot'||args[1]!=='--output')throw Error('explicit_one_shot_output_required')
 const env=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),cfg=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'))
 if(env.FOP_QUERIES_PAUSED!=='true'||env.WORKBENCH_SYNC_ENABLED!=='false'||env.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('persistent_pause_required')
 if(cfg.FOP_KINGDEE_USERNAME!=='limingsong'||cfg.FOP_KINGDEE_TENANT_ID!=='hyperzone.test'||cfg.FOP_KINGDEE_ORGANIZATION_IDS!=='100000')throw Error('confirmed_identity_required')
 const directory=path.resolve(args[2]);fs.mkdirSync(directory,{mode:0o700})
 const require=createRequire(import.meta.url);require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
 const {KingdeeFopDataProvider}=require('../backend/src/modules/fop-data/fop-kingdee.provider')
 // Process-local override for this explicit read only. Persistent files and app processes stay paused.
 const config={...cfg,FOP_QUERIES_PAUSED:'false'},provider=new KingdeeFopDataProvider({get:key=>config[key]})
 const c=await provider.getConnectionContext()
 if(c.subject.tenantId!==cfg.FOP_KINGDEE_TENANT_ID||c.subject.userId!==cfg.FOP_KINGDEE_USER_ID||c.currentOrganization.id!=='100000')throw Error('connection_mismatch')
 config.FOP_OPENAPI_ACCESS_TOKEN=await getToken(config)
 const result=await capturePurchaseRefundCandidates({directory,context:c.subject,query:q=>runQuery(config,q)})
 console.log(JSON.stringify({complete:result.complete,rows:result.rowCount,pages:result.pages.length,semanticType:result.semanticType,physicalReturnIntegration:false,error:result.error??null,sourceFailure:result.sourceFailure??null,automaticCallsEnabled:false}))
 if(!result.complete)process.exitCode=1
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('purchase_refund_capture_failed; credentials and raw responses are not logged');process.exitCode=1})
