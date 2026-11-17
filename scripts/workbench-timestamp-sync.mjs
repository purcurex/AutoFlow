#!/usr/bin/env node
// Explicit operator command only. No timers, no automatic pause override, no FOP business writes.
import {readFileSync,existsSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {getToken} from './fop-openapi-smoke.mjs'
import {runQuery} from './fop-workbench-openapi.mjs'
const root=dirname(dirname(fileURLToPath(import.meta.url))),require=createRequire(import.meta.url)
export function timestampPagedIdentityConfig(config,profile){
 const tenantIds=[config.FOP_KINGDEE_TENANT_ID,config.FOP_REPLICA_TENANT_ID].filter(Boolean).map(x=>x.trim())
 if(!tenantIds.length||tenantIds.some(x=>x!==profile.tenantId))throw Error('timestamp_configured_tenant_mismatch')
 const userId=config.FOP_KINGDEE_USER_ID?.trim(),username=config.FOP_KINGDEE_USERNAME?.trim()
 if(!userId||!username||config.FOP_OPENAPI_USERNAME?.trim()!==username)throw Error('timestamp_configured_identity_missing')
 if(config.FOP_KINGDEE_ORGANIZATION_IDS?.trim()!==profile.companyId)throw Error('timestamp_configured_company_mismatch')
 return {tenantId:profile.tenantId,userId,username,companyId:profile.companyId}
}
export function timestampPagedConnectionBasis(connection,expected,verifiedAt=new Date().toISOString()){
 if(connection?.subject?.tenantId!==expected.tenantId||connection?.subject?.userId!==expected.userId||connection?.currentOrganization?.id!==expected.companyId)throw Error('timestamp_connection_identity_mismatch')
 return {...expected,verifiedAt,basis:'kingdee_get_connection_context',scopeProof:false,stableScopeProof:false}
}
export async function prepareTimestampPagedExecution(config,profile,{getConnection,acquireToken=getToken,query=runQuery}){
 const assertUnpaused=()=>{if(config.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true')throw Error('fop_queries_paused')}
 assertUnpaused()
 const expected=timestampPagedIdentityConfig(config,profile)
 const connection=await getConnection();assertUnpaused()
 const identityBasis=timestampPagedConnectionBasis(connection,expected)
 const token=await acquireToken(config);assertUnpaused()
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('timestamp_credentials_not_configured')
 // Memory only: runQuery's getToken returns this cached token on every numbered page.
 config.FOP_OPENAPI_ACCESS_TOKEN=token
 return {identityBasis,query:async parameters=>{assertUnpaused();return query(config,parameters)}}
}
export function timestampArguments(args){
 const out={execute:false,mode:'incremental'}
 for(let i=0;i<args.length;i++){
  if(args[i]==='--execute')out.execute=true
  else if(args[i]==='--authorize-one-shot')out.authorizeOneShot=true
  else if(['--profile','--batch-id','--mode'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))out[args[i++].slice(2)]=args[i]
  else throw Error('timestamp_invalid_arguments')
 }
 if(out.authorizeOneShot&&!out.execute)throw Error('timestamp_one_shot_requires_execute')
 if(!['initialize','incremental','reconcile'].includes(out.mode))throw Error('timestamp_invalid_mode')
 if(out['batch-id']&&!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(out['batch-id']))throw Error('timestamp_invalid_batch_id')
 return out
}
export function timestampExecutionConfig(config,options){
 if(!options.authorizeOneShot)return {...config}
 if(!options.execute)throw Error('timestamp_one_shot_requires_execute')
 if(config.WORKBENCH_SYNC_ENABLED!=='false'||config.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('timestamp_one_shot_automation_must_be_disabled')
 return {...config,FOP_QUERIES_PAUSED:'false'}
}
export function timestampPreflight(config,options,profile){
 const reasons=[]
 if(config.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true')reasons.push('fop_queries_paused')
 if(config.WORKBENCH_MOCK_ENABLED==='true')reasons.push('timestamp_mock_forbidden')
 if(!profile)reasons.push('timestamp_profile_required')
 else if(profile.version===2?profile.protocol!=='ordinary_modified_pages'||profile.packageVersion!=='2026-11-16'||profile.acknowledgeEventualConsistency!==true:profile.verified!==true)reasons.push('timestamp_profile_unverified')
 if(profile?.version===2){try{timestampPagedIdentityConfig(config,profile)}catch(error){reasons.push(error.message)}}
 if(!options['batch-id'])reasons.push('timestamp_batch_id_required')
 if(!['127.0.0.1','localhost'].includes(config.DB_HOST)||config.DB_PORT!=='55432'||config.DB_DATABASE!=='autoflow_local_demo')reasons.push('timestamp_explicit_local_database_required')
 if(!config.FOP_OPENAPI_IDENTITY||!config.FOP_OPENAPI_ACCESS_TOKEN&&['FOP_OPENAPI_CLIENT_ID','FOP_OPENAPI_CLIENT_SECRET','FOP_OPENAPI_USERNAME','FOP_OPENAPI_ACCOUNT_ID'].some(k=>!config[k]))reasons.push('timestamp_existing_credentials_missing')
 return {mode:options.mode,executable:reasons.length===0,blockedReasons:reasons,automaticCallsEnabled:false,upstreamCalled:false,protocol:profile?.version===2?'ordinary_modified_pages':'strict_keyset',clockBasis:profile?.version===2?'local_capture_time':'source_clock',consistentSnapshot:false,projectionCoverage:profile?.version===2?'four_entities_transactional_local_projection; incomplete_records_pending':'fulfillment_header_only; related_and_other_entities_pending'}
}
async function main(){
 const options=timestampArguments(process.argv.slice(2)),configs=['backend/.env.workbench.local','backend/.env.fop.local','backend/.env.fop-pause'].filter(p=>existsSync(resolve(root,p))).map(p=>parseEnv(readFileSync(resolve(root,p),'utf8')))
 let config=Object.assign({},...configs)
 // A pause in any private configuration wins. This command never writes these files.
 if(configs.some(c=>c.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true'))config.FOP_QUERIES_PAUSED='true'
 const profile=options.profile?JSON.parse(readFileSync(resolve(options.profile),'utf8')):null
 config=timestampExecutionConfig(config,options)
 const report=timestampPreflight(config,options,profile)
 if(!options.execute){console.log(JSON.stringify(report));return}
 if(!report.executable){console.log(JSON.stringify(report));process.exitCode=1;return}
 require('ts-node').register({project:resolve(root,'backend/tsconfig.json'),transpileOnly:true});require('reflect-metadata')
 const {TimestampSync}=require('../backend/src/modules/workbench-replica/timestamp-sync')
 const {TimestampPostgresStore}=require('../backend/src/modules/workbench-replica/timestamp-postgres')
 const {TimestampHttpSource}=require('../backend/src/modules/workbench-replica/timestamp-http-source')
 const scope={batchId:options['batch-id'],tenantId:profile.tenantId,companyId:profile.companyId,entityCode:profile.entityCode}
 let token
 const {TimestampPagedSource}=require('../backend/src/modules/workbench-replica/timestamp-paged-source')
 const {TimestampPagedSync}=require('../backend/src/modules/workbench-replica/timestamp-paged-sync')
 let prepared
 if(profile.version===2){
  const {KingdeeFopDataProvider}=require('../backend/src/modules/fop-data/fop-kingdee.provider')
  const provider=new KingdeeFopDataProvider({get:key=>config[key]})
  prepared=await prepareTimestampPagedExecution(config,profile,{getConnection:()=>provider.getConnectionContext()})
 }
 const source=profile.version===2?new TimestampPagedSource(profile,()=>config.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true',prepared.query,prepared.identityBasis):new TimestampHttpSource(profile,{paused:()=>config.FOP_QUERIES_PAUSED?.trim().toLowerCase()==='true',identity:config.FOP_OPENAPI_IDENTITY,tokenHeader:config.FOP_OPENAPI_TOKEN_HEADER,
  token:async()=>token??(token=await getToken(config))})
 source.assertReady(scope)
 const {DataSource}=require('typeorm'),db=await new DataSource({type:'postgres',host:config.DB_HOST,port:+config.DB_PORT,username:config.DB_USERNAME,password:config.DB_PASSWORD,database:config.DB_DATABASE,logging:false}).initialize()
 try{
  const [{present}]=await db.query("SELECT to_regclass('hz_fop_timestamp_state') IS NOT NULL AS present")
  if(!present)throw Error('timestamp_migration_required')
  const Engine=profile.version===2?TimestampPagedSync:TimestampSync
  console.log(JSON.stringify(await new Engine(new TimestampPostgresStore(db),source).run(scope,options.mode)))
 }finally{await db.destroy()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof Error&&/^(timestamp_|fop_queries_paused)[a-z_]*$/.test(error.message)?error.message:'timestamp_sync_failed; private response and credentials not logged');process.exitCode=1})
