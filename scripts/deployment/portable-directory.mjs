/** Portable local identity/configuration data. FOP identities and credentials never travel. */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseEnv} from 'node:util'
const require=createRequire(new URL('../../backend/package.json',import.meta.url))
export const columns={
 users:['id','email','username','role','display_id','workbench_roles','business_role','business_department_id','business_employee_id','chart_permissions','account_disabled','organization_workspace_owner_id','data_display_scope'],
 organization_nodes:['id','owner_user_id','parent_id','name','kind','sort_order'],
 organization_employees:['id','owner_user_id','department_id','account_id','name','code','email','job_title','workbench_roles','archived_at'],
}
export function validateBundle(b){
 if(b?.schemaVersion!==1||b?.kind!=='hyperzone-portable-directory')throw Error('invalid_bundle')
 const ids={};for(const [table,cols] of Object.entries(columns)){
  if(!Array.isArray(b[table]))throw Error('missing_table_'+table)
  ids[table]=new Set();for(const row of b[table]){
   if(Object.keys(row).some(k=>!cols.includes(k))||cols.some(k=>!(k in row)))throw Error('unexpected_columns_'+table)
   if(!/^[0-9a-f-]{36}$/.test(row.id)||ids[table].has(row.id))throw Error('duplicate_or_invalid_id');ids[table].add(row.id)
  }
 }
 const has=(t,id)=>id===null||ids[t].has(id)
 for(const u of b.users){if(!has('organization_nodes',u.business_department_id)||!has('organization_employees',u.business_employee_id)||!has('users',u.organization_workspace_owner_id))throw Error('invalid_local_account_reference')}
 for(const n of b.organization_nodes){if(!has('users',n.owner_user_id)||!has('organization_nodes',n.parent_id))throw Error('invalid_department_reference')}
 for(const e of b.organization_employees){if(!has('users',e.owner_user_id)||!has('users',e.account_id)||!has('organization_nodes',e.department_id))throw Error('invalid_employee_reference')}
 if(!b.users.some(u=>u.role==='admin'&&!u.account_disabled))throw Error('active_admin_required')
 const pending=[...b.organization_nodes],ordered=[];while(pending.length){const i=pending.findIndex(n=>n.parent_id===null||ordered.some(p=>p.id===n.parent_id));if(i<0)throw Error('department_cycle');ordered.push(pending.splice(i,1)[0])}
 return ordered
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
export async function importDirectory(client,b,{execute=false,password}={}){
 const nodes=validateBundle(b);await client.query('BEGIN')
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('hyperzone-directory-import',0))")
  await client.query('LOCK TABLE users,organization_nodes,organization_employees IN SHARE ROW EXCLUSIVE MODE')
  let total=0,matching=true
  for(const [table,cols] of Object.entries(columns)){
   const rows=(await client.query(`SELECT ${cols.join(',')} FROM ${table}`)).rows;total+=rows.length
   if(rows.length!==b[table].length)matching=false
   for(const row of rows){const expected=b[table].find(v=>v.id===row.id);if(!expected||cols.some(k=>!equal(row[k] instanceof Date?row[k].toISOString():row[k],expected[k])))matching=false}
  }
  if(total){if(!matching)throw Error('target_directory_not_empty_or_conflicts');await client.query('ROLLBACK');return {status:'already_imported',changed:0}}
  const result={status:execute?'imported':'validated',accounts:b.users.length,departments:nodes.length,employees:b.organization_employees.length,fopBindings:0}
  if(!execute){await client.query('ROLLBACK');return result}
  const {isValidAccountPassword}=require('./dist/src/common/account-password-policy.js')
  if(!isValidAccountPassword(password))throw Error('DIRECTORY_INITIAL_PASSWORD_required')
  const bcrypt=require('bcrypt')
  const insert=async(table,row)=>{const keys=Object.keys(row);await client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>k==='chart_permissions'?JSON.stringify(row[k]):row[k]))}
  for(const u of b.users)await insert('users',{...u,organization_workspace_owner_id:null,password:await bcrypt.hash(password,12)})
  for(const u of b.users)await client.query('UPDATE users SET organization_workspace_owner_id=$1 WHERE id=$2',[u.organization_workspace_owner_id,u.id])
  for(const n of nodes)await insert('organization_nodes',n)
  for(const e of b.organization_employees)await insert('organization_employees',e)
  await client.query("SELECT setval('users_display_id_seq',GREATEST((SELECT max(display_id::bigint) FROM users), (SELECT last_value FROM users_display_id_seq)),true)")
  await client.query('COMMIT');return result
 }catch(e){await client.query('ROLLBACK');throw e}
}
async function main(){
 const [file,envFile,mode]=process.argv.slice(2)
 if(!file||!envFile||!['--check','--execute'].includes(mode))throw Error('usage: node scripts/deployment/portable-directory.mjs bundle.json /secure/production.env --check|--execute')
 const c={...parseEnv(readFileSync(envFile,'utf8')),...process.env}
 if(c.NODE_ENV!=='production')throw Error('explicit_production_environment_required')
 const {Client}=require('pg');const client=new Client({host:c.DB_HOST,port:Number(c.DB_PORT||5432),user:c.DB_USERNAME,password:c.DB_PASSWORD,database:c.DB_DATABASE,ssl:c.DB_SSL==='true'?{rejectUnauthorized:c.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:false,connectionTimeoutMillis:15000})
 await client.connect();try{console.log(JSON.stringify(await importDirectory(client,JSON.parse(readFileSync(file,'utf8')),{execute:mode==='--execute',password:c.DIRECTORY_INITIAL_PASSWORD}),null,2))}finally{await client.end()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.code||e.message);process.exitCode=1})
