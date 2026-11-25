import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, readFileSync } from 'node:fs'
import {spawnSync} from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scheduledProfile, scheduledPreflight, readScheduledConfig } from './workbench-scheduled-sync.mjs'

const production = {
 NODE_ENV:'production', WORKBENCH_TIMESTAMP_ENVIRONMENT:'production',
 WORKBENCH_READ_MODE:'local', WORKBENCH_COLLECTED_ENABLED:'true', WORKBENCH_MOCK_ENABLED:'false',
 FOP_QUERIES_PAUSED:'false', WORKBENCH_AUTOMATIC_CALLS_ENABLED:'true', WORKBENCH_SYNC_ENABLED:'true', WORKBENCH_TIMESTAMP_SYNC_ENABLED:'true',
 FOP_REPLICA_TENANT_ID:'production-tenant', FOP_REPLICA_COMPANY_ID:'200001', FOP_REPLICA_ORG_NUMBER:'production-org',
 FOP_KINGDEE_TENANT_ID:'production-tenant', FOP_KINGDEE_ORGANIZATION_IDS:'200001', FOP_KINGDEE_USER_ID:'300001', FOP_KINGDEE_USERNAME:'integration',
 FOP_OPENAPI_USERNAME:'integration', FOP_OPENAPI_IDENTITY:'identity', FOP_OPENAPI_ACCOUNT_ID:'account', FOP_OPENAPI_CLIENT_ID:'client', FOP_OPENAPI_CLIENT_SECRET:'secret',
 FOP_OPENAPI_BASE_URL:'https://production.example.com', FOP_OPENAPI_ALLOWED_ORIGIN:'https://production.example.com',
 FOP_KINGDEE_TOKEN_URL:'https://production.example.com/ierp/accessToken.do',
 FOP_KINGDEE_IDENTITY:'identity', FOP_KINGDEE_ACCOUNT_ID:'account',FOP_KINGDEE_CLIENT_ID:'client',FOP_KINGDEE_CLIENT_SECRET:'secret',FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL:'https://production.example.com/connection',
 DB_HOST:'db.internal', DB_PORT:'5432', DB_DATABASE:'production', DB_USERNAME:'worker', DB_PASSWORD:'private',
 DB_SSL:'true', DB_SSL_REJECT_UNAUTHORIZED:'true',
}
test('production profile and preflight use explicit deployment scope instead of test constants', () => {
 const profile=scheduledProfile('hzkj_orders',production)
 assert.equal(profile.companyId,'200001'); assert.equal(profile.tenantId,'production-tenant'); assert.equal(profile.orgNumber,'production-org')
 assert.equal(scheduledPreflight(production).executable,true)
 for(const key of ['FOP_REPLICA_ORG_NUMBER','FOP_OPENAPI_ALLOWED_ORIGIN','DB_DATABASE','FOP_KINGDEE_IDENTITY','FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL','FOP_KINGDEE_CLIENT_SECRET'])
  assert.equal(scheduledPreflight({...production,[key]:''}).executable,false,key)
 assert.equal(scheduledPreflight({...production,FOP_KINGDEE_ORGANIZATION_IDS:'100000'}).executable,false)
 assert.equal(scheduledPreflight({...production,FOP_KINGDEE_TOKEN_URL:'https://other.example.com/token'}).executable,false)
 assert.equal(scheduledPreflight({...production,NODE_ENV:'development'}).executable,false)
})
test('production loads backend/.env and deployment environment, never private test overrides', () => {
 const dir=mkdtempSync(join(tmpdir(),'hz-sync-config-'));mkdirSync(join(dir,'backend'))
 try {
  writeFileSync(join(dir,'backend/.env'),'NODE_ENV=production\nDB_DATABASE=from-file\nFOP_QUERIES_PAUSED=false\n')
  writeFileSync(join(dir,'backend/.env.fop.local'),'DB_DATABASE=test-db\nFOP_QUERIES_PAUSED=true\n')
  const c=readScheduledConfig({root:dir,env:{NODE_ENV:'production',DB_DATABASE:'from-process'}})
  assert.equal(c.DB_DATABASE,'from-process');assert.equal(c.FOP_QUERIES_PAUSED,'false')
  const fileOnly=readScheduledConfig({root:dir,env:{}})
  assert.equal(fileOnly.DB_DATABASE,'from-file')
 } finally {rmSync(dir,{recursive:true,force:true})}
})
test('development pause wins across files and process overrides', () => {
 const dir=mkdtempSync(join(tmpdir(),'hz-sync-pause-'));mkdirSync(join(dir,'backend'))
 try {
  writeFileSync(join(dir,'backend/.env.fop-pause'),'FOP_QUERIES_PAUSED=true\n')
  assert.equal(readScheduledConfig({root:dir,env:{FOP_QUERIES_PAUSED:'false'}}).FOP_QUERIES_PAUSED,'true')
 } finally {rmSync(dir,{recursive:true,force:true})}
})
test('deployment payload loads compiled worker modules without TypeScript and blocked execution is nonzero',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hz-sync-package-'))
 try{
  mkdirSync(join(dir,'backend'));mkdirSync(join(dir,'scripts'))
  cpSync('backend/dist',join(dir,'backend/dist'),{recursive:true})
  cpSync('backend/package.json',join(dir,'backend/package.json'))
  for(const file of JSON.parse(readFileSync('scripts/deployment/sync-worker-files.json','utf8')))cpSync(join('scripts',file),join(dir,'scripts',file))
  symlinkSync(join(process.cwd(),'node_modules'),join(dir,'node_modules'),'dir')
  const modules=['workbench-replica/replica-schedule','workbench-replica/timestamp-postgres','workbench-replica/timestamp-paged-sync','workbench-replica/timestamp-paged-source','workbench-replica/timestamp-maintenance','fop-data/fop-kingdee.provider','workbench-replica/collected-api-relations','workbench-replica/relation-refresh','workbench-replica/collected-chain-storage','fop-data/collected-stock-native']
  writeFileSync(join(dir,'probe.cjs'),`const M=require('node:module'),load=M._load;M._load=function(id,...args){if(id.includes('ts-node')||id==='typescript'||id.endsWith('.ts'))throw Error('dev_dependency_used');return load.call(this,id,...args)};import('./scripts/workbench-sync-runtime.mjs').then(({syncRuntimeRequire})=>{const r=syncRuntimeRequire({NODE_ENV:'production'});for(const n of ${JSON.stringify(modules)})r(n);console.log('compiled-runtime-ok')}).catch(e=>{console.error(e.stack);process.exitCode=1})`)
  const loaded=spawnSync(process.execPath,['probe.cjs'],{cwd:dir,encoding:'utf8'})
  assert.equal(loaded.status,0,loaded.stderr);assert.match(loaded.stdout,/compiled-runtime-ok/)
  const env={PATH:process.env.PATH,...production}
  const preflight=spawnSync(process.execPath,['scripts/workbench-scheduled-sync.mjs'],{cwd:dir,env,encoding:'utf8'})
  assert.equal(preflight.status,0,preflight.stderr);assert.equal(JSON.parse(preflight.stdout).executable,true)
  const blocked=spawnSync(process.execPath,['scripts/workbench-scheduled-sync.mjs','--execute'],{cwd:dir,env:{...env,FOP_QUERIES_PAUSED:'true'},encoding:'utf8'})
  assert.equal(blocked.status,1);assert.equal(JSON.parse(blocked.stdout).upstreamCalled,false)
  rmSync(join(dir,'backend/dist/src/modules/workbench-replica/timestamp-maintenance.js'))
  const incomplete=spawnSync(process.execPath,['scripts/workbench-scheduled-sync.mjs'],{cwd:dir,env,encoding:'utf8'})
  assert.equal(JSON.parse(incomplete.stdout).executable,false)
  assert.ok(JSON.parse(incomplete.stdout).blockedReasons.includes('timestamp_compiled_runtime_required'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('production binds identity validation and acquisition to one automatic credential group',()=>{
 for(const suffix of ['IDENTITY','ACCOUNT_ID','CLIENT_ID','CLIENT_SECRET','USERNAME'])
  assert.equal(scheduledPreflight({...production,['FOP_OPENAPI_'+suffix]:'other'}).executable,false,suffix)
 for(const key of ['FOP_OPENAPI_ACCESS_TOKEN','FOP_KINGDEE_ACCESS_TOKEN'])
  assert.equal(scheduledPreflight({...production,[key]:'preconfigured-bearer'}).executable,false,key)
})
