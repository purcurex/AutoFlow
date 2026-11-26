import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {readSyncConfig,syncDatabaseOptions} from '../workbench-sync-runtime.mjs'
import {validateBundle,importDirectory} from './portable-directory.mjs'
const root=resolve(import.meta.dirname,'../..'),require=createRequire(new URL('../../backend/package.json',import.meta.url))
const file=process.env.DIRECTORY_TEST_BUNDLE
const b=file?JSON.parse(readFileSync(file,'utf8')):null

test('portable directory validates references and rejects source identities',()=>{
 const a={schemaVersion:1,kind:'hyperzone-portable-directory',users:[],organization_nodes:[],organization_employees:[]}
 assert.throws(()=>validateBundle(a),/active_admin_required/)
 if(b){validateBundle(b);const bad=structuredClone(b);bad.users[0].fop_user_id='123';assert.throws(()=>validateBundle(bad),/unexpected_columns/);const cycle=structuredClone(b);cycle.organization_nodes[0].parent_id=cycle.organization_nodes[0].id;assert.throws(()=>validateBundle(cycle),/department_cycle/)}
})
test('real migrated disposable DB: import, password, no FOP bindings, rerun and conflict protection',{skip:!b},async()=>{
 const {Client}=require('pg'),c=readSyncConfig(),o=syncDatabaseOptions(c),opts={host:o.host,port:o.port,user:o.username,password:o.password,ssl:o.ssl},admin=new Client({...opts,database:o.database})
 const name='hz_directory_test_'+Date.now();let db,created=false
 await admin.connect()
 try{
  await admin.query(`CREATE DATABASE "${name}"`);created=true
  execFileSync(process.execPath,['scripts/deployment/migrate-compiled.mjs','run'],{cwd:root,env:{...process.env,...c,NODE_ENV:'test',DB_DATABASE:name},stdio:'pipe',maxBuffer:16*1024*1024})
  db=new Client({...opts,database:name});await db.connect()
  const check=await importDirectory(db,b);assert.equal(check.status,'validated');assert.equal((await db.query('SELECT count(*)::int n FROM users')).rows[0].n,0)
  await assert.rejects(importDirectory(db,b,{execute:true,password:'bad'}),/PASSWORD/)
  const password='Temporary-test-only-928!';const result=await importDirectory(db,b,{execute:true,password});assert.equal(result.accounts,b.users.length)
  const rows=(await db.query('SELECT password,fop_user_id,fop_tenant_id,fop_binding_details FROM users')).rows;assert.equal(rows.length,b.users.length)
  for(const row of rows){assert.equal(row.fop_user_id,null);assert.equal(row.fop_tenant_id,null);assert.equal(row.fop_binding_details,null);assert.ok(await require('bcrypt').compare(password,row.password))}
  assert.equal(new Set(rows.map(r=>r.password)).size,rows.length)
  assert.equal((await importDirectory(db,b,{execute:true,password:'Different-password-928!'})).status,'already_imported')
  const changed=structuredClone(b);changed.users[0].username+='-conflict';await assert.rejects(importDirectory(db,changed,{execute:true,password}),/conflicts/)
  assert.equal((await db.query('SELECT username FROM users WHERE id=$1',[b.users[0].id])).rows[0].username,b.users[0].username)
  const report={verifiedAt:new Date().toISOString(),disposableDatabase:true,migrationsApplied:true,accounts:rows.length,departments:b.organization_nodes.length,employees:b.organization_employees.length,checkNoWrites:true,importSucceeded:true,repeatNoChanges:true,conflictRejected:true,passwordsHashedIndividually:true,fopBindingsCopied:0,productionConnected:false}
  writeFileSync(resolve(file,'../verification.json'),JSON.stringify(report,null,2)+'\n')
 }finally{if(db)await db.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end()}
})
