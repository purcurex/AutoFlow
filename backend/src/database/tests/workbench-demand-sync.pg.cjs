/* Demand sync regression: real PostgreSQL, synthetic adapter, disposable database only. */
require('reflect-metadata')
require('ts-node').register({ project: 'backend/tsconfig.json', transpileOnly: true })
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto')
const { DataSource } = require('typeorm'), { ConfigService } = require('@nestjs/config')
const { ReplicaSyncService } = require('../../modules/workbench-replica/replica-sync.service')
const { ReplicaPublisher } = require('../../modules/workbench-replica/replica-publisher')
const { WORKBENCH_TABLE_COLUMNS } = require('../workbench-schema')
const database = process.env.WORKBENCH_VALIDATION_DATABASE || 'hz_ddl_validation_1794392169018'
assert.match(database, /^hz_ddl_validation_\d+$/)
const ids = Object.fromEntries(['connection','company','dataset','stream'].map(key=>[key,randomUUID()]))
const scope={connectionId:ids.connection,companyId:ids.company,datasetId:ids.dataset}
const db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,
 password:fs.readFileSync('.runtime/local-demo/database-password','utf8').trim()})
async function cleanup(companyId = ids.company, connectionId = ids.connection) {
  await db.transaction(async m => {
    await m.query('SET CONSTRAINTS ALL DEFERRED')
    await m.query('UPDATE hz_fop_companies SET active_dataset_id=NULL WHERE id=$1', [companyId])
    await m.query('UPDATE hz_fop_refresh_requests SET barrier_id=NULL WHERE company_id=$1', [companyId])
    const pending = Object.entries(WORKBENCH_TABLE_COLUMNS).filter(([, columns]) => columns.includes('company_id')).map(([table]) => table)
    while (pending.length) {
      let progress = false
      for (const table of [...pending]) {
        await m.query('SAVEPOINT cleanup_row')
        try {
          await m.query(`DELETE FROM ${table} WHERE company_id=$1`, [companyId])
          pending.splice(pending.indexOf(table), 1); progress = true
        } catch (error) { await m.query('ROLLBACK TO SAVEPOINT cleanup_row'); if (error.code !== '23503') throw error }
        await m.query('RELEASE SAVEPOINT cleanup_row')
      }
      assert.ok(progress, 'Fixture FK cleanup must make progress')
    }
    await m.query('DELETE FROM hz_fop_companies WHERE id=$1', [companyId])
    await m.query('DELETE FROM hz_fop_connections WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM hz_fop_companies WHERE connection_id=$1)', [connectionId])
  })
}
;(async()=>{
 await db.initialize()
 try {
  const [a,b]=await db.query('SELECT id FROM users ORDER BY id LIMIT 2')
  assert.ok(a&&b)
  await db.query("INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES($1,$2,'Demand test','test','fixture','https://example.invalid','fixture','active')",[ids.connection,a.id])
  await db.query("INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,name,enabled) VALUES($1,$2,'demand','demand','demand',true)",[ids.company,ids.connection])
  await db.query("INSERT INTO hz_fop_datasets(id,connection_id,company_id,state,validated_at,activated_at) VALUES($1,$2,$3,'active',now(),now())",[ids.dataset,ids.connection,ids.company])
  await db.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1',[ids.company,ids.dataset])
  await db.query("INSERT INTO hz_fop_sync_streams(id,connection_id,company_id,dataset_id,stream_key,state,source_scope_version,applied_cursor) VALUES($1,$2,$3,$4,'business','ready','v1','head')",[ids.stream,ids.connection,ids.company,ids.dataset])
  const local={enabled:true,replicaScope:async()=>[scope]}, config=new ConfigService({FOP_QUERIES_PAUSED:'false',WORKBENCH_SYNC_ENABLED:'false'})
  let barrierCalls=0,hold=null
  const source={isConfigured:()=>true,barrier:async()=>{
   barrierCalls++;if(hold)await hold
   return {id:randomUUID(),scopeVersion:'v1',sourceAsOf:new Date(Date.now()-500).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),targetVector:{business:'head'},proof:{synthetic:true}}
  },groups:async()=>{throw Error('Already at target')}}
  const publisher=new ReplicaPublisher(db), sync=new ReplicaSyncService(db,local,config,source,publisher), worker2=new ReplicaSyncService(db,local,config,source,publisher)
  const requests=await Promise.all([sync.request(a.id,'nav-a','navigation'),sync.request(b.id,'nav-b','navigation'),sync.request(a.id,'nav-a','navigation')])
  assert.equal(requests[0].id,requests[2].id)
  assert.notEqual(requests[0].id,requests[1].id)
  assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_sync_runs WHERE company_id=$1',[ids.company]))[0].n,1)
  assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_sync_tasks WHERE company_id=$1',[ids.company]))[0].n,1)
  await assert.rejects(()=>sync.job(b.id,requests[0].id),/not found/i)
  await sync.tick()
  for(const [i,user]of[[0,a],[1,b]])assert.equal((await sync.job(user.id,requests[i].id)).state,'succeeded')
  assert.equal(barrierCalls,1)
  const receipts=await db.query('SELECT barrier_id,target_watermarks FROM hz_fop_refresh_requests WHERE company_id=$1',[ids.company])
  assert.ok(receipts.every(r=>r.barrier_id&&r.target_watermarks.business==='head'))
  assert.equal((await sync.request(a.id,'nav-fresh','navigation')).state,'skipped')
  assert.equal(barrierCalls,1)
  // Manual ignores cooldown; a manual arriving during a captured/running barrier shares one follow-up run.
  const manual=await sync.request(a.id,'manual')
  assert.equal(manual.state,'pending')
  let release;hold=new Promise(resolve=>{release=resolve})
  const working=sync.tick()
  for(let i=0;barrierCalls<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(barrierCalls,2)
  const [f1,f2,nav]=await Promise.all([sync.request(a.id,'followup-a'),sync.request(b.id,'followup-b'),sync.request(b.id,'nav-during','navigation')])
  assert.equal(f1.state,'pending');assert.equal(f2.state,'pending')
  await worker2.tick()
  assert.equal(barrierCalls,2,'Second worker must not overlap same dataset')
  release();await working;hold=null
  assert.equal((await sync.job(a.id,manual.id)).state,'succeeded')
  assert.equal((await sync.job(a.id,f1.id)).state,'pending','Old barrier cannot satisfy new manual request')
  await worker2.tick()
  for(const [job,user]of[[f1,a],[f2,b],[nav,b]])assert.equal((await sync.job(user.id,job.id)).state,'succeeded')
  assert.equal(barrierCalls,3)
  // Failure is throttled for navigation too; explicit manual retry remains available.
  const failureSource={...source,barrier:async()=>{throw Error('Synthetic source failure')}}
  const failing=new ReplicaSyncService(db,local,config,failureSource,publisher)
  const failed=await failing.request(a.id,'failure')
  await failing.tick();assert.equal((await failing.job(a.id,failed.id)).state,'failed')
  assert.equal((await failing.request(a.id,'cooldown','navigation')).state,'skipped')
  const paused=new ReplicaSyncService(db,local,new ConfigService({FOP_QUERIES_PAUSED:'true'}),source,publisher)
  assert.equal((await paused.request(a.id,'paused-nav','navigation')).state,'skipped')
  const mocked=new ReplicaSyncService(db,{...local,mock:true},config,source,publisher)
  assert.equal((await mocked.request(a.id,'mock-nav','navigation')).state,'skipped')
  await mocked.tick();await paused.tick();assert.equal(barrierCalls,3)
  const uninitialized=new ReplicaSyncService(db,{enabled:true,replicaScope:async()=>[]},config,source,publisher)
  await assert.rejects(()=>uninitialized.request(a.id,'empty','navigation'))
  const next=await sync.request(a.id,'independent-manual')
  const unavailableOwner=randomUUID()
  const dbWithBadSchedule={transaction:db.transaction.bind(db),query:(sql,params)=>sql.startsWith('SELECT c.workspace_owner_id')?Promise.resolve([{workspace_owner_id:unavailableOwner,last_scheduled:null}]):db.query(sql,params)}
  const scopeChecked={enabled:true,replicaScope:async user=>{if(user===unavailableOwner)throw Error('Disabled scheduler owner');return [scope]}}
  const scheduledWorker=new ReplicaSyncService(dbWithBadSchedule,scopeChecked,new ConfigService({FOP_QUERIES_PAUSED:'false',WORKBENCH_SYNC_ENABLED:'true'}),source,publisher)
  await scheduledWorker.tick()
  assert.equal((await sync.job(a.id,next.id)).state,'succeeded','Unavailable scheduled owner cannot block manual task')
  const mixed=new ReplicaSyncService(db,{enabled:true,replicaScope:async()=>[scope,{...scope,companyId:randomUUID(),datasetId:null}]},config,source,publisher)
  assert.equal((await mixed.request(a.id,'partly-initialized-schedule','scheduled')).state,'pending','Schedule initialized companies without blocking on others')
  console.log(JSON.stringify({status:'passed',database,scenarios:['cross-user coalescing','per-user receipts','idempotency','60s navigation cooldown','manual bypass','old barrier follow-up','multi-worker dataset serialization','shared terminal receipts','failure cooldown','pause/mock hard guard','initialization guard','unavailable owner schedule isolation','partially initialized schedule']}))
 } finally {try{await cleanup()}finally{await db.destroy()}}
})().catch(e=>{console.error(e.message);process.exitCode=1})
