// Explicit one-shot dispatch backfill. No persistent switch changes or business writes.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { runQuery } from './fop-workbench-openapi.mjs'
import { getToken } from './fop-openapi-smoke.mjs'

if (process.argv[2] !== '--authorize-one-shot' || !process.argv[3]) throw Error('explicit_output_required')
const env = parseEnv(fs.readFileSync('backend/.env.workbench.local', 'utf8'))
const fop = parseEnv(fs.readFileSync('backend/.env.fop.local', 'utf8'))
if (env.FOP_QUERIES_PAUSED !== 'true' || env.WORKBENCH_SYNC_ENABLED !== 'false' || env.WORKBENCH_AUTOMATIC_CALLS_ENABLED !== 'false') throw Error('persistent_pause_required')
const config = { ...env, ...fop, FOP_QUERIES_PAUSED: 'false' }
if (config.FOP_KINGDEE_TENANT_ID !== 'hyperzone.test' || config.FOP_KINGDEE_ORGANIZATION_IDS !== '100000') throw Error('scope_mismatch')
const require = createRequire(import.meta.url)
require('ts-node').register({ project: path.resolve('backend/tsconfig.json'), transpileOnly: true })
const { KingdeeFopDataProvider } = require('../backend/src/modules/fop-data/fop-kingdee.provider')
const context = await new KingdeeFopDataProvider({ get: key => config[key] }).getConnectionContext()
if (context.subject.userId !== config.FOP_KINGDEE_USER_ID || context.subject.tenantId !== 'hyperzone.test' || context.currentOrganization.id !== '100000') throw Error('identity_mismatch')
config.FOP_OPENAPI_ACCESS_TOKEN = await getToken(config)
const directory=path.resolve(process.argv[3]);fs.mkdirSync(directory,{recursive:true,mode:0o700})
const manifestPath=path.join(directory,'manifest.json'),resume=process.argv[4]==='--resume'
const previous=resume?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null
if(previous&&(previous.complete||previous.context.userId!==context.subject.userId||previous.companyId!=='100000'))throw Error('invalid_resume')
if(!resume&&fs.existsSync(manifestPath))throw Error('output_already_used')
let requests=previous?.requests??0
const startedAt=previous?.startedAt??new Date().toISOString(),pages=previous?.pages??[],ids=new Set()
for(const p of pages){const raw=fs.readFileSync(path.join(directory,p.file),'utf8');if(createHash('sha256').update(raw).digest('hex')!==p.sha256)throw Error('resume_hash_mismatch');for(const r of JSON.parse(raw).data.rows)ids.add(r.id)}
const sourceTime=t=>new Date(t+8*3600000).toISOString().slice(0,19).replace('T',' ')
const query=async options => {
    if (++requests > 850) throw Error('request_budget_exceeded')
    if (requests > 1) await new Promise(resolve => setTimeout(resolve, 750))
    const result = await runQuery(config, options)
    if (requests === 1 && result.report.success) {
      const rows = JSON.parse(result.raw).data.rows
      const keys = Object.keys(rows[0] ?? {}).filter(k => /bizoperator|sale_org|actual_freight|textfield[12]/.test(k))
      console.log(JSON.stringify({ firstPageVerified: true, fields: keys, total: JSON.parse(result.raw).data.totalCount }))
      if (!rows.length || !keys.some(k => k === 'hzkj_bizoperator_id' || k === 'hzkj_bizoperator') || !keys.some(k => k === 'hzkj_sale_org_id' || k === 'hzkj_sale_org')) throw Error('native_ownership_fields_missing')
    }
    return result
}
// Every accepted interval fits in ONE response. No offset paging under concurrent modifications.
async function window(from,to,kind){
 const result=await query({operation:'dispatch',orgNumber:'hyperzone.test',startModifytime:sourceTime(from),endModifytime:sourceTime(to),pageNo:1,pageSize:100,saveResponse:true})
 if(!result.report.success)throw Error('source_query_failed')
 const d=JSON.parse(result.raw).data
 if(!d.filter?.includes('org in (100000)')||!d.filter.includes("org.number = 'hyperzone.test'"))throw Error('scope_mismatch')
 if(!d.lastPage){const mid=Math.floor((from+to)/2000)*1000;if(mid<=from||mid>=to)throw Error('source_same_second_limit');await window(from,mid,kind);await window(mid,to,kind);return}
 if(d.rows.length!==d.totalCount||new Set(d.rows.map(r=>r.id)).size!==d.rows.length)throw Error('incomplete_window')
 for(const r of d.rows){if(typeof r.id!=='string'||r.org_id!=='100000')throw Error('invalid_identity');ids.add(r.id)}
 const file=`window-${String(pages.length+1).padStart(4,'0')}.json`;fs.writeFileSync(path.join(directory,file),result.raw,{mode:0o600,flag:'wx'})
 pages.push({file,sha256:createHash('sha256').update(result.raw).digest('hex'),rows:d.rows.length,from:sourceTime(from),toExclusive:sourceTime(to),kind})
 if(pages.length%25===0)console.log(JSON.stringify({requests,windows:pages.length,uniqueRows:ids.size}))
}
let complete=false,error=null
const cutoff=Math.floor(Date.parse(startedAt)/1000)*1000
try{
 let cursor=Date.parse('1970-01-01T00:00:00+08:00')
 const covered=pages.filter(p=>p.kind==='historical').map(p=>({from:Date.parse(p.from.replace(' ','T')+'+08:00'),to:Date.parse(p.toExclusive.replace(' ','T')+'+08:00')})).sort((a,b)=>a.from-b.from)
 for(const p of covered){if(p.from>cursor)await window(cursor,p.from,'historical');cursor=Math.max(cursor,p.to)}
 if(cursor<cutoff)await window(cursor,cutoff,'historical')
 const end=Math.floor(Date.now()/1000)*1000;if(end>cutoff)await window(cutoff-1000,end,'closing_increment');complete=true
}catch(e){error=/^[a-z_]+$/.test(e.message)?e.message:'capture_failed'}
const manifest={version:2,entityType:'dispatch',context:context.subject,companyId:'100000',coverage:'full_company_scan',consistentSnapshot:false,startedAt,capturedAt:new Date().toISOString(),complete,rowCount:ids.size,requests,pages,error}
if(previous)fs.copyFileSync(manifestPath,path.join(directory,`manifest-before-resume-${previous.requests}.json`))
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600,flag:resume?'w':'wx'})
console.log(JSON.stringify({complete,rows:ids.size,requests,error,automaticCallsEnabled:false}))
if(!complete)process.exitCode=1
