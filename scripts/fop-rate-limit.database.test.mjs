import test from 'node:test'
import assert from 'node:assert/strict'
import {Pool,Client} from 'pg'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {budgetedFetch} from './fop-budgeted-fetch.mjs'
import {readSyncConfig,syncRuntimeRequire,syncDatabaseOptions} from './workbench-sync-runtime.mjs'

test('separate database clients share atomic admissions and durable cooldowns', {skip:process.env.FOP_RATE_DATABASE_TEST!=='true'}, async()=>{
 const config=readSyncConfig(),o=syncDatabaseOptions(config)
 assert.ok(['localhost','127.0.0.1'].includes(o.host));assert.equal(o.database,'autoflow_local_demo')
 const options={host:o.host,port:o.port,user:o.username,password:o.password,database:o.database}
 const admin=new Client(options),schema='rate_test_'+randomUUID().replaceAll('-','')
 const {PostgresBudgetStore,ratePolicy}=syncRuntimeRequire(config)('fop-data/fop-rate-limit')
 const policy=ratePolicy({get:()=>undefined}),scope='https://isolated.example'
 const pools=[0,1,2].map(()=>new Pool({...options,max:4,options:'-c search_path='+schema}))
 await admin.connect()
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`)
  await admin.query(`CREATE TABLE "${schema}".hz_fop_api_budgets(scope text PRIMARY KEY,state jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now())`)
  const stores=pools.map(p=>new PostgresBudgetStore(p))
  const admitted=await Promise.all(Array.from({length:12},(_,i)=>stores[i%3].reserve(scope,policy)))
  assert.equal(admitted.filter(r=>r.allowed).length,1)
  await new Promise(r=>setTimeout(r,510))
  assert.equal((await new PostgresBudgetStore(pools[1]).reserve(scope,policy)).allowed,true)
  await stores[0].restrict(scope,{kind:'rate',delayMs:3*86400000})
  const deferred=await stores[2].reserve(scope,policy)
  assert.equal(deferred.allowed,false);assert.equal(deferred.reason,'cooldown');assert.ok(deferred.retryAfterMs>3*86400000-1000)
  await stores[1].restrict(scope,{kind:'rate',delayMs:60000})
  assert.ok((await stores[0].reserve(scope,policy)).retryAfterMs>3*86400000-1000)
  await stores[0].restrict(scope,{kind:'billing',delayMs:86400000})
  assert.equal((await new PostgresBudgetStore(pools[2]).reserve(scope,policy)).reason,'billing')
  const state=(await admin.query(`SELECT state FROM "${schema}".hz_fop_api_budgets`)).rows[0].state
  assert.equal(state.recent.length,2);assert.equal(state.hours[0][1],2)
 }finally{await Promise.all(pools.map(p=>p.end()));await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end()}
})

test('legacy CLI and explicit runtime configuration share the real transport budget', {skip:process.env.FOP_RATE_DATABASE_TEST!=='true'}, async()=>{
 const config=readSyncConfig(),o=syncDatabaseOptions(config)
 assert.ok(['localhost','127.0.0.1'].includes(o.host));assert.equal(o.database,'autoflow_local_demo')
 const db=new Client({host:o.host,port:o.port,user:o.username,password:o.password,database:o.database})
 let requests=0
 const server=createServer((_request,response)=>{
  requests++
  response.setHeader('content-type','application/json')
  response.end(JSON.stringify(requests===1?{status:true,errorCode:'0'}:{errorCode:'2528'}))
 })
 await db.connect()
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 try{
  // No FOP URL or credentials: a local fake gateway verifies file-config resolution.
  const legacy=budgetedFetch({}),runtime=budgetedFetch(config)
  assert.equal((await legacy(origin+'/oauth')).status,200)
  const limited=await runtime(origin+'/query',{method:'POST'})
  assert.equal(limited.status,429)
  assert.equal((await legacy(origin+'/audit',{method:'POST'})).status,429)
  assert.equal(requests,2)
  const {rows}=await db.query('SELECT state FROM hz_fop_api_budgets WHERE scope=$1',[origin])
  assert.equal(rows[0].state.recent.length,2)
  assert.ok(rows[0].state.blockedUntil>Date.now())
 }finally{
  await new Promise(resolve=>server.close(resolve))
  await db.query('DELETE FROM hz_fop_api_budgets WHERE scope=$1',[origin]);await db.end()
 }
})
