#!/usr/bin/env node
import {mkdirSync,writeFileSync,existsSync,readFileSync,renameSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {readSyncConfig,syncRuntimeRequire,syncScope} from './workbench-sync-runtime.mjs'
import {runQuery} from './fop-workbench-openapi.mjs'
import {getToken} from './fop-openapi-smoke.mjs'
export const catalogOperations=['stock','purchase','purchase-requisition','receipt-notice','inbound','outbound-list','receipt','payment','rma','customer-registrations']
export function validateCatalogPage(body,{pageNo,pageSize,total,seen,companyId,orgNumber}){
 const d=body?.data
 if(body?.status!==true||String(body.errorCode)!=='0'||!d||d.pageNo!==pageNo||d.pageSize!==pageSize||!Number.isSafeInteger(d.totalCount)||d.totalCount<0||total!==undefined&&total!==d.totalCount||!Array.isArray(d.rows)||d.rows.length>pageSize||typeof d.lastPage!=='boolean')throw Error('catalog_page_invalid')
 // Responses must carry the requested exact organization number; row IDs are also checked.
 if(typeof d.filter!=='string'||!/^[\[\]()\p{L}\p{N}_\s.'=,]+$/u.test(d.filter)||/\b(or|not)\b/i.test(d.filter)||!d.filter.includes(`org.number = '${orgNumber}'`))throw Error('catalog_scope_unverified')
 for(const row of d.rows){if(typeof row.id!=='string'||! /^[1-9]\d{0,30}$/.test(row.id)||seen.has(row.id))throw Error('catalog_duplicate_id');for(const key of ['org_id','createorg_id'])if(row[key]!=null&&row[key]!==companyId)throw Error('catalog_company_mismatch');seen.add(row.id)}
 if(seen.size>d.totalCount||d.lastPage&&seen.size!==d.totalCount||!d.lastPage&&(!d.rows.length||seen.size>=d.totalCount))throw Error('catalog_incomplete_pages')
 return d.totalCount
}
export async function captureCatalog(query,operation,directory,scope){
 mkdirSync(directory,{recursive:true,mode:0o700});const pageSize=operation==='stock'?1:operation==='purchase'?20:50;const m={operation,pageSize,...scope,capturedAt:new Date().toISOString(),complete:false,consistentSnapshot:false,pages:[],rows:0};const seen=new Set();let total
 try{for(let pageNo=1;pageNo<=1000;pageNo++){
  const result=await query({operation,orgNumber:scope.orgNumber,...(operation==='customer-registrations'?{orgId:scope.companyId,orgName:scope.orgName}:{}),pageNo,pageSize,saveResponse:true})
  if(!result.report.success||!result.raw)throw Error('catalog_'+result.report.errorCategory)
  const body=JSON.parse(result.raw);total=validateCatalogPage(body,{pageNo,pageSize,total,seen,...scope})
  const file=`page-${String(pageNo).padStart(4,'0')}.json`;writeFileSync(resolve(directory,file),result.raw,{mode:0o600,flag:'wx'});m.pages.push({file,sha256:createHash('sha256').update(result.raw).digest('hex')});m.rows=seen.size
  if(body.data.lastPage){m.complete=true;break}
 }if(!m.complete)throw Error('catalog_page_limit')
 }catch(e){m.error=e.message}finally{m.finishedAt=new Date().toISOString();writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600})}
 return m
}
async function main(){if(process.argv[2]!=='--execute')throw Error('explicit_execute_required');const c=readSyncConfig();if(c.FOP_QUERIES_PAUSED==='true')throw Error('fop_queries_paused');const runtime=syncRuntimeRequire(c),{KingdeeFopDataProvider}=runtime('fop-data/fop-kingdee.provider');const connection=await new KingdeeFopDataProvider({get:k=>c[k]}).getConnectionContext();if(connection.subject?.tenantId!==c.FOP_REPLICA_TENANT_ID||connection.subject?.userId!==c.FOP_KINGDEE_USER_ID||connection.currentOrganization?.id!==c.FOP_REPLICA_COMPANY_ID)throw Error('catalog_connection_mismatch');c.FOP_OPENAPI_ACCESS_TOKEN=await getToken(c);let last=0
 const query=async opts=>{await new Promise(r=>setTimeout(r,Math.max(0,500-(Date.now()-last))));last=Date.now();return runQuery(c,opts)}
 for(const operation of catalogOperations){const directory=`.runtime/api-20261125/catalog/${operation}`;if(existsSync(directory+'/manifest.json')){const prior=JSON.parse(readFileSync(directory+'/manifest.json'));if(prior.complete){console.log(JSON.stringify({operation,complete:true,rows:prior.rows,reused:true}));continue}renameSync(directory,directory+'-incomplete-'+Date.now())}const m=await captureCatalog(query,operation,directory,{userId:c.FOP_KINGDEE_USER_ID,tenantId:c.FOP_REPLICA_TENANT_ID,companyId:c.FOP_REPLICA_COMPANY_ID,orgNumber:syncScope(c).orgNumber,orgName:'杭州华智云服科技有限公司'});console.log(JSON.stringify({operation,complete:m.complete,rows:m.rows,pages:m.pages.length,error:m.error}));if(!m.complete)process.exitCode=1}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/workbench-authorized-catalog-capture.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1})
