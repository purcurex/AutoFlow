import { budgetedFetch } from './fop-budgeted-fetch.mjs'
// Explicit read-only company scan. Does not enable scheduled FOP calls or write the database.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {getToken} from './fop-openapi-smoke.mjs';
if(process.argv[2]!=='--authorize-one-shot'||!process.argv[3])throw Error('explicit_authorization_and_directory_required');
const directory=process.argv[3],local=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),config=parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'));
if(local.FOP_QUERIES_PAUSED!=='true'||config.FOP_KINGDEE_TENANT_ID!=='hyperzone.test'||config.FOP_KINGDEE_ORGANIZATION_IDS!=='100000')throw Error('paused_test_company_required');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const manifest=fs.existsSync(directory+'/manifest.json')?JSON.parse(fs.readFileSync(directory+'/manifest.json','utf8')):{entityType:'fulfillment',companyId:'100000',context:{tenantId:'hyperzone.test'},coverage:'full_company_scan',startedAt:new Date().toISOString(),complete:false,consistentSnapshot:false,pages:[],rowCount:0};
if(manifest.complete||manifest.companyId!=='100000'||manifest.context?.tenantId!=='hyperzone.test'||manifest.entityType!=='fulfillment')throw Error('invalid_resume_capture');
const save=()=>fs.writeFileSync(directory+'/manifest.json',JSON.stringify(manifest,null,2),{mode:0o600});save();
const token=await getToken({...local,...config,FOP_QUERIES_PAUSED:'false'}),seen=new Set();let total;
const end=manifest.endModifyTime??new Date(Date.parse(manifest.startedAt)+86400000).toISOString().slice(0,10)+' 00:00:00';manifest.endModifyTime=end;
async function page(n){
 let raw;
 const previous=manifest.pages[n-1];
 if(previous){raw=fs.readFileSync(directory+'/'+previous.file,'utf8');if(createHash('sha256').update(raw).digest('hex')!==previous.sha256)throw Error('resume_hash_mismatch')}
 else for(let attempt=0;attempt<3;attempt++){
  try{const response=await budgetedFetch({...local,...config})('https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderList',{method:'POST',headers:{'Content-Type':'application/json',[config.FOP_OPENAPI_TOKEN_HEADER||'accessToken']:token,'x-acgw-identity':config.FOP_OPENAPI_IDENTITY},body:JSON.stringify({data:{org_number:'hyperzone.test',start_modifytime:'2020-01-01 00:00:00',end_modifytime:end},pageNo:n,pageSize:100}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('capture_http_'+response.status);raw=await response.text();JSON.parse(raw);break;
  }catch(error){if(attempt===2||/^capture_http_(429|403|519)$/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)))}
 }
 const body=JSON.parse(raw),d=body.data;
 if(body.status!==true||String(body.errorCode)!=='0'||!d?.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'")||d.pageNo!==n||!Array.isArray(d.rows))throw Error('invalid_page_'+n);
 total??=d.totalCount;if(!Number.isSafeInteger(total)||total<0||total!==d.totalCount||d.lastPage!==(n===Math.max(1,Math.ceil(total/100))))throw Error('unstable_scan_'+n);
 for(const row of d.rows){if(typeof row.id!=='string'||seen.has(row.id))throw Error('duplicate_or_invalid_identity');seen.add(row.id)}
 const file='page-'+n+'.json';fs.writeFileSync(directory+'/'+file,raw,{mode:0o600});manifest.pages[n-1]={file,sha256:createHash('sha256').update(raw).digest('hex'),rows:d.rows.length};manifest.rowCount=seen.size;
}
try{
 await page(1);console.log(JSON.stringify({total,pages:Math.ceil(total/100),directory}));
 for(let n=2;n<=Math.ceil(total/100);n+=3){await Promise.all(Array.from({length:Math.min(3,Math.ceil(total/100)-n+1)},(_,i)=>page(n+i)));save();if(n%30===2)console.log('Captured '+seen.size+' / '+total)}
 if(seen.size!==total)throw Error('incomplete_scan');manifest.capturedAt=new Date().toISOString();manifest.complete=true;delete manifest.error;save();console.log(JSON.stringify({complete:true,total,capturedAt:manifest.capturedAt}));
}catch(error){manifest.error=error.message;save();throw error}
