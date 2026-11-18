import {randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import bcrypt from 'bcrypt'
import {Client} from 'pg'
import {readSyncConfig,syncScope,syncDatabaseOptions} from '../workbench-sync-runtime.mjs'
import {confirmedFopOrigin} from '../fop-confirmed-origin.mjs'
import {productionReadiness} from './production-readiness.mjs'
async function transaction(c,key,fn){
 await c.query('BEGIN')
 try{const lock=(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[key])).rows[0];if(!lock.locked)throw Error('production_init_busy');const result=await fn();await c.query('COMMIT');return result}catch(error){await c.query('ROLLBACK');throw error}
}
export async function prepareProductionAdmin(c,{email,username,password,organizationName}){
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email??'')||!username?.trim()||username.length>100||!organizationName?.trim()||organizationName.length>100||typeof password!=='string'||password.length<16||password.length>72||/replace-with|待填写/.test(password))throw Error('production_init_admin_input_invalid')
 email=email.trim().toLowerCase();username=username.trim()
 return transaction(c,'production-initial-administrator',async()=>{
  const existing=(await c.query('SELECT id,email,username,role,account_disabled,organization_workspace_owner_id FROM users WHERE lower(email)=$1 OR username=$2 FOR UPDATE',[email,username])).rows
  if(existing.length){const u=existing[0];if(existing.length!==1||u.email!==email||u.username!==username||u.role!=='admin'||u.account_disabled||u.organization_workspace_owner_id!==u.id)throw Error('production_init_admin_conflict');return {created:false,userId:u.id,passwordUnchanged:true,upstreamCalled:false}}
  const userId=randomUUID(),rootId=randomUUID(),hash=await bcrypt.hash(password,12)
  await c.query("INSERT INTO users(id,email,username,password,role,business_role,organization_workspace_owner_id,workbench_roles,chart_permissions) VALUES($1,$2,$3,$4,'admin','admin',$1,ARRAY['sales','procurement','allocation','dispatch','warehouse'],'[]'::jsonb)",[userId,email,username,hash])
  await c.query("INSERT INTO organization_nodes(id,owner_user_id,parent_id,name,kind,sort_order) VALUES($1,$2,NULL,$3,'organization',0)",[rootId,userId,organizationName.trim()])
  return {created:true,userId,organizationId:rootId,upstreamCalled:false}
 })
}
export async function prepareProductionBatch(c,{adminEmail,tenantId,companyId,orgNumber,baseUrl}){
 syncScope({NODE_ENV:'production',FOP_REPLICA_TENANT_ID:tenantId,FOP_REPLICA_COMPANY_ID:companyId,FOP_REPLICA_ORG_NUMBER:orgNumber})
 const origin=confirmedFopOrigin({NODE_ENV:'production',WORKBENCH_TIMESTAMP_ENVIRONMENT:'production',FOP_OPENAPI_BASE_URL:baseUrl,FOP_OPENAPI_ALLOWED_ORIGIN:baseUrl})
 return transaction(c,`timestamp-scheduled:${tenantId}:${companyId}`,async()=>{
  const users=(await c.query("SELECT id,organization_workspace_owner_id FROM users WHERE lower(email)=$1 AND role='admin' AND business_role='admin' AND account_disabled=false FOR UPDATE",[adminEmail?.trim().toLowerCase()])).rows
  if(users.length!==1||users[0].organization_workspace_owner_id!==users[0].id)throw Error('production_init_admin_required')
  const owner=users[0].id
  const prior=(await c.query("SELECT id,workspace_owner_id,tenant_id,company_id,metadata FROM hz_fop_collected_batches WHERE state='active' AND (workspace_owner_id=$1 OR (tenant_id=$2 AND company_id=$3)) FOR UPDATE",[owner,tenantId,companyId])).rows
  if(prior.length){const b=prior[0];if(prior.length!==1||b.workspace_owner_id!==owner||b.tenant_id!==tenantId||b.company_id!==companyId||b.metadata?.deploymentScope?.orgNumber!==orgNumber||b.metadata?.deploymentScope?.baseUrl!==origin)throw Error('production_init_scope_conflict');return {created:false,batchId:b.id,upstreamCalled:false}}
  const batchId=randomUUID(),metadata={deploymentScope:{environment:'production',orgNumber,baseUrl:origin},productionPreparation:{sourceCaptured:false,preparedAt:new Date().toISOString()},readOnly:true,consistentSnapshot:false,sourceTimeMeaning:'local_preparation_time_not_source_capture'}
  await c.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of,metadata) VALUES($1,$2,$3,$4,'active',now(),$5::jsonb)",[batchId,owner,tenantId,companyId,JSON.stringify(metadata)])
  return {created:true,batchId,upstreamCalled:false,sourceCaptured:false}
 })
}
async function main(){
 const [action,execute,...extra]=process.argv.slice(2)
 if(!['admin','batch'].includes(action)||execute!=='--execute'||extra.length)throw Error('production_init_explicit_action_required')
 const config=readSyncConfig(),readiness=productionReadiness(config)
 if(!readiness.databaseReady){console.log(JSON.stringify(readiness,null,2));process.exitCode=1;return}
 const options=syncDatabaseOptions(config),c=new Client({host:options.host,port:options.port,user:options.username,password:options.password,database:options.database,ssl:options.ssl,connectionTimeoutMillis:15000})
 await c.connect()
 try{
  const pending=(await c.query("SELECT to_regclass('public.hz_fop_timestamp_state') AS present")).rows[0];if(!pending.present)throw Error('production_init_migrations_required')
  const result=action==='admin'?await prepareProductionAdmin(c,{email:config.ADMIN_BOOTSTRAP_EMAIL,username:config.ADMIN_BOOTSTRAP_USERNAME,password:config.ADMIN_BOOTSTRAP_PASSWORD,organizationName:config.PRODUCTION_ORGANIZATION_NAME}):await prepareProductionBatch(c,{...syncScope(config),adminEmail:config.ADMIN_BOOTSTRAP_EMAIL,baseUrl:confirmedFopOrigin(config)})
  console.log(JSON.stringify(result,null,2))
 }finally{await c.end()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^production_init_[a-z_]+$/.test(error.message)?error.message:'production_init_failed');process.exitCode=1})
