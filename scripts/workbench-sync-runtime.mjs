import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)))
const productionSync=c=>c.NODE_ENV==='production'||c.WORKBENCH_TIMESTAMP_ENVIRONMENT==='production'
export function readSyncConfig({root=projectRoot,env=process.env}={}) {
 const read=p=>existsSync(resolve(root,p))?parseEnv(readFileSync(resolve(root,p),'utf8')):{}
 const base=read('backend/.env'),production=productionSync({...base,...env})
 const files=production?[base]:[base,...['backend/.env.workbench.local','backend/.env.fop.local','backend/.env.fop-pause'].map(read)]
 const config=Object.assign({},...files,env)
 if([...files,env].some(c=>c.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true'))config.FOP_QUERIES_PAUSED='true'
 return config
}
export function syncScope(config={}) {
 const production=productionSync(config)
 const tenantId=config.FOP_REPLICA_TENANT_ID??(production?'':'hyperzone.test')
 const companyId=config.FOP_REPLICA_COMPANY_ID??(production?'':'100000')
 const orgNumber=config.FOP_REPLICA_ORG_NUMBER??(!production&&tenantId==='hyperzone.test'&&companyId==='100000'?'hyperzone.test':'')
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(tenantId)||!/^[1-9]\d{0,18}$/.test(companyId)||!/^[A-Za-z0-9_.-]{1,100}$/.test(orgNumber))throw Error('timestamp_schedule_scope_invalid')
 return {tenantId,companyId,orgNumber}
}
export function syncDatabaseOptions(c) {
 return {type:'postgres',host:c.DB_HOST,port:Number(c.DB_PORT||5432),username:c.DB_USERNAME,password:c.DB_PASSWORD,database:c.DB_DATABASE,
  ssl:c.DB_SSL==='true'?{rejectUnauthorized:c.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:false,
  connectTimeoutMS:15000,extra:{max:4,connectionTimeoutMillis:15000},logging:false}
}
export function syncRuntimeRequire(config,{root=projectRoot}={}) {
 const require=createRequire(resolve(root,'backend/package.json'))
 require('reflect-metadata')
 const production=productionSync(config)
 if(!production)require('ts-node').register({project:resolve(root,'backend/tsconfig.json'),transpileOnly:true})
 return name=>{
  if(!/^[a-z0-9-]+\/[a-z0-9-]+(?:\.[a-z0-9-]+)?$/.test(name))throw Error('timestamp_runtime_module_invalid')
  const file=resolve(root,production?'backend/dist/src/modules':'backend/src/modules',name+(production?'.js':'.ts'))
  if(!existsSync(file))throw Error('timestamp_compiled_runtime_required')
  return require(file)
 }
}
