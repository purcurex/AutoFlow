import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { ENTITIES, runScheduledCycle, scheduledMode, scheduledNext, scheduledDue, scheduledEnabled, scheduledPreflight, scheduledPageQuery } from './workbench-scheduled-sync.mjs'
const require = createRequire(import.meta.url)
require('ts-node').register({ project: resolve('backend/tsconfig.json'), transpileOnly: true })
const { nextReplicaSync, dueReplicaSync } = require('../backend/src/modules/workbench-replica/replica-schedule')
const now = () => new Date('2026-11-18T02:01:00Z')
const config = { WORKBENCH_READ_MODE: 'local', FOP_QUERIES_PAUSED: 'false', WORKBENCH_COLLECTED_ENABLED: 'true', WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'true', WORKBENCH_SYNC_ENABLED: 'true', WORKBENCH_TIMESTAMP_SYNC_ENABLED: 'true' }
function fixture({ acquired = true, state, deploymentScope, checkpoint = { watermark: '2026-11-18T01:30:00Z', full_at: now().toISOString() }, prepareError, entityError } = {}) {
  const events = [], writes = []
  const query = async (sql, args) => {
    events.push(sql)
    if (sql.includes('pg_try_advisory_lock')) return [{ acquired }]
    if (sql.startsWith('SELECT id,metadata')) return [{ id: 'batch', metadata: { timestampSchedule: state, deploymentScope } }]
    if (sql.startsWith('UPDATE')) { writes.push(JSON.parse(args[1])); return [[{ id: 'batch' }], 1] }
    if (sql.startsWith('SELECT s.watermark')) return [checkpoint]
    return []
  }
  const options = { config, db: { createQueryRunner: () => ({ connect: async () => {}, query, release: async () => events.push('release') }) }, now, nextReplicaSync, dueReplicaSync,
    prepare: async () => { events.push('authenticate'); if (prepareError) throw Error(prepareError); return { token: 'private' } },
    runEntity: async (scope, mode) => { events.push(scope.entityCode); if (entityError === scope.entityCode) throw Error('timestamp_source_rejected'); return { state: 'applied', changed: 3, pages: 1, rows: 4 } } }
  return { options, events, writes }
}
test('flags require explicit permission; default preflight makes no FOP calls', () => {
  assert.equal(scheduledEnabled(config), true)
  for (const key of Object.keys(config)) assert.equal(scheduledEnabled({ ...config, [key]: undefined }), false)
  assert.equal(scheduledPreflight({}).executable, false)
})
test('each entity independently chooses initialization, daily compensation or increment', () => {
  assert.equal(scheduledMode(null, null, now()), 'initialize')
  assert.equal(scheduledMode('w', null, now()), 'reconcile')
  assert.equal(scheduledMode('w', '2026-11-17T02:01:00Z', now()), 'reconcile')
  assert.equal(scheduledMode('w', now().toISOString(), now()), 'incremental')
})
test('missed slots coalesce; restart waits for durable next attempt; backoff bounded', () => {
  assert.equal(scheduledDue({}, now()), true)
  assert.equal(scheduledDue({ nextAttemptAt: '2026-11-18T02:02:00Z' }, now()), false)
  assert.equal(scheduledNext(now(), 1, nextReplicaSync), '2026-11-18T02:31:00.000Z')
  assert.equal(scheduledNext(now(), 2, nextReplicaSync), '2026-11-18T03:01:00.000Z')
  assert.equal(scheduledNext(now(), 20, nextReplicaSync), '2026-11-18T04:01:00.000Z')
})
test('claim persists before auth; all four run once, sequentially; lock always releases', async () => {
  const f = fixture(), result = await runScheduledCycle(f.options)
  assert.equal(result.status, 'succeeded'); assert.equal(result.entities.length, 4)
  assert.ok(f.events.findIndex(e => e.startsWith('UPDATE')) < f.events.indexOf('authenticate'))
  assert.deepEqual(f.events.filter(e => ENTITIES.includes(e)), ENTITIES)
  assert.equal(f.writes[0].lastStatus, 'running'); assert.ok(Date.parse(f.writes[0].nextAttemptAt) > now().getTime())
  assert.equal(f.events.at(-1), 'release'); assert.ok(f.events.at(-2).includes('pg_advisory_unlock'))
  const resumed = fixture({ state: result }); assert.equal((await runScheduledCycle(resumed.options)).status, 'not_due'); assert.ok(!resumed.events.includes('authenticate'))
})
test('paused or lock held never authenticates', async () => {
  const locked = fixture({ acquired: false }); assert.equal((await runScheduledCycle(locked.options)).status, 'locked'); assert.ok(!locked.events.includes('authenticate'))
  const paused = fixture(); assert.equal((await runScheduledCycle({ ...paused.options, enabled: () => false })).status, 'paused'); assert.equal(paused.events.length, 0)
})
test('auth and entity failure keep durable backoff; later entities continue without resetting others', async () => {
  const f = fixture({ entityError: ENTITIES[1] }), result = await runScheduledCycle(f.options)
  assert.equal(result.status, 'failed'); assert.equal(result.entities[0].status, 'applied'); assert.equal(result.entities[3].status, 'applied')
  assert.equal(result.failureCount, 1); assert.equal(result.nextAttemptAt, '2026-11-18T02:30:00.000Z')
  const auth = fixture({ prepareError: 'secret token' }), failed = await runScheduledCycle(auth.options)
  assert.equal(failed.errorCode, 'timestamp_scheduled_failed'); assert.ok(!JSON.stringify(failed).includes('secret'))
})
test('a pause between entities stops remaining pages and persists safe request counters', async () => {
  const f = fixture(); let enabled = true
  const result = await runScheduledCycle({ ...f.options, enabled: () => enabled,
    runEntity: async () => { enabled = false; return { state: 'applied', pages: 1, rows: 2, changed: 1 } },
    getRequestStats: () => ({ requests: 3, minStartIntervalMs: 501 }),
  })
  assert.equal(result.entities.length, 1); assert.equal(result.status, 'failed')
  assert.deepEqual(f.writes.at(-1).network, { requests: 3, minStartIntervalMs: 501 })
})
const parameters = { operation: 'order-list', pageNo: 230 }
const queryResult = (httpStatus, errorCategory, success = false) => ({ report: { httpStatus, errorCategory, success }, raw: 'PRIVATE_PAYLOAD', rows: [] })
test('transient page failures retry once after two seconds and preserve safe recovery diagnostics', async () => {
  for (const failure of [queryResult(null, 'timeout'), queryResult(null, 'network-error'), queryResult(503, 'http-error')]) {
    let calls = 0; const delays = [], diagnostics = []
    const success = queryResult(200, null, true)
    const result = await scheduledPageQuery({ parameters, enabled: () => true, record: d => diagnostics.push(d), sleep: async ms => delays.push(ms),
      query: async () => ++calls === 1 ? failure : success })
    assert.equal(result, success); assert.equal(calls, 2); assert.deepEqual(delays, [2000])
    assert.equal(diagnostics[0].retryScheduled, true); assert.equal(diagnostics[1].attempt, 2)
    assert.deepEqual(diagnostics[0], { entityCode: 'hzkj_orders', pageNo: 230, attempt: 1, httpStatus: failure.report.httpStatus, errorCategory: failure.report.errorCategory, retryScheduled: true })
    assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'))
  }
})
test('repeated transient failure stops after one retry, never loops', async () => {
  let calls = 0; const diagnostics = []
  await scheduledPageQuery({ parameters, enabled: () => true, record: d => diagnostics.push(d), sleep: async () => {}, query: async () => { calls++; return queryResult(502, 'http-error') } })
  assert.equal(calls, 2); assert.equal(diagnostics.at(-1).retryScheduled, false)
})
test('519,429,authentication,parameters,malformed data and business failures never immediately retry', async () => {
  for (const failure of [queryResult(519, 'http-error'), queryResult(519, 'api-not-subscribed'), queryResult(429, 'http-error'), queryResult(401, 'http-error'), queryResult(null, 'authentication-error'), queryResult(null, 'invalid-request'), queryResult(200, 'invalid-response'), queryResult(200, 'invalid-json'), queryResult(200, 'business-error')]) {
    let calls = 0
    const execution=()=>scheduledPageQuery({ parameters, enabled: () => true, sleep: async () => assert.fail('must not back off/retry'), query: async () => { calls++; return failure } })
    if([429,401].includes(failure.report.httpStatus)||failure.report.errorCategory==='authentication-error')await assert.rejects(execution,/timestamp_source_(rate_limited|unauthorized)/)
    else assert.equal(await execution(),failure)
    assert.equal(calls, 1)
  }
})
test('pause during retry backoff blocks the second request', async () => {
  let calls = 0, enabled = true
  await assert.rejects(scheduledPageQuery({ parameters, enabled: () => enabled, sleep: async () => { enabled = false }, query: async () => { calls++; return queryResult(null, 'timeout') } }), /fop_queries_paused/)
  assert.equal(calls, 1)
})
test('untrusted error text is excluded and bounded source diagnostics are durably saved', async () => {
  const diagnostics = []
  await scheduledPageQuery({ parameters, enabled: () => true, record: d => diagnostics.push(d), query: async () => queryResult(200, 'SECRET_ACCESS_TOKEN') })
  assert.equal(diagnostics[0].errorCategory, 'query-error'); assert.ok(!JSON.stringify(diagnostics).includes('SECRET'))
  const f = fixture({ entityError: ENTITIES[0] })
  const result = await runScheduledCycle({ ...f.options, getEntityDiagnostics: entity => entity === ENTITIES[0] ? diagnostics : [] })
  assert.deepEqual(result.entities[0].sourceDiagnostics, diagnostics)
  assert.deepEqual(f.writes.at(-1).entities[0].sourceDiagnostics, diagnostics)
  assert.equal(result.entities[3].status, 'applied')
})
test('401 refreshes once for a read; forbidden response never refreshes', async () => {
 let calls=0,refreshes=0
 const result=await scheduledPageQuery({parameters,enabled:()=>true,refreshCredentials:async()=>{refreshes++;return true},
  query:async()=>++calls===1?queryResult(401,'http-error'):queryResult(200,null,true)})
 assert.equal(result.report.success,true);assert.equal(calls,2);assert.equal(refreshes,1)
 await assert.rejects(scheduledPageQuery({parameters,enabled:()=>true,refreshCredentials:async()=>assert.fail('403 must not refresh'),
  query:async()=>queryResult(403,'http-error')}),/timestamp_source_forbidden/)
})
test('429 stops the cycle and persists the server cooldown without another entity request', async () => {
 const f=fixture()
 const result=await runScheduledCycle({...f.options,runEntity:async()=>{
  const e=Error('timestamp_source_rate_limited');e.retryAfterMs=3*60*60*1000;throw e
 }})
 assert.equal(result.entities.length,1);assert.equal(result.nextAttemptAt,'2026-11-18T05:01:00.000Z')
 assert.equal(result.errorCode,'timestamp_source_rate_limited')
})
test('entity backoff does not delay healthy entities and survives the next cycle', async () => {
 const first=await runScheduledCycle(fixture({entityError:ENTITIES[1]}).options)
 assert.equal(first.nextAttemptAt,'2026-11-18T02:30:00.000Z')
 assert.equal(first.entityRetry[ENTITIES[1]].nextAttemptAt,'2026-11-18T02:31:00.000Z')
 const later=fixture({state:first})
 const result=await runScheduledCycle({...later.options,now:()=>new Date('2026-11-18T02:30:00Z')})
 assert.deepEqual(later.events.filter(e=>ENTITIES.includes(e)),[ENTITIES[0],ENTITIES[2],ENTITIES[3]])
 assert.equal(result.entities[1].status,'backoff')
})
test('rate limit during authentication retains source cooldown despite provider error wrapping',async()=>{
 const f=fixture({prepareError:'wrapped-auth-error'})
 const result=await runScheduledCycle({...f.options,getSourceBlock:()=>({code:'timestamp_source_rate_limited',until:now().getTime()+10800000})})
 assert.equal(result.nextAttemptAt,'2026-11-18T05:01:00.000Z');assert.equal(result.errorCode,'timestamp_source_rate_limited')
 assert.equal(result.entities.length,0)
})
test('second unauthorized response and credential refresh failure stop with no third business query',async()=>{
 let calls=0,refreshes=0
 await assert.rejects(scheduledPageQuery({parameters,enabled:()=>true,refreshCredentials:async()=>{refreshes++;return true},query:async()=>{calls++;return queryResult(401,'http-error')}}),/timestamp_source_unauthorized/)
 assert.equal(calls,2);assert.equal(refreshes,1)
})

test('production refuses persisted origin or org drift before authentication and without schedule writes',async()=>{
 const deploymentScope={environment:'production',baseUrl:'https://fop.example.invalid',orgNumber:'prod-org'}
 const c={...config,NODE_ENV:'production',WORKBENCH_TIMESTAMP_ENVIRONMENT:'production',FOP_REPLICA_TENANT_ID:'prod',FOP_REPLICA_COMPANY_ID:'200001',FOP_REPLICA_ORG_NUMBER:'prod-org',FOP_OPENAPI_BASE_URL:'https://fop.example.invalid',FOP_OPENAPI_ALLOWED_ORIGIN:'https://fop.example.invalid'}
 for(const scope of [undefined,{...deploymentScope,environment:'test'},{...deploymentScope,orgNumber:'other'},{...deploymentScope,baseUrl:'https://other.example.invalid'}]){
  const f=fixture({deploymentScope:scope});await assert.rejects(runScheduledCycle({...f.options,config:c}),/timestamp_production_batch_scope_mismatch/);assert.ok(!f.events.includes('authenticate'));assert.equal(f.writes.length,0)
 }
 const f=fixture({deploymentScope});assert.equal((await runScheduledCycle({...f.options,config:c})).status,'succeeded')
})
