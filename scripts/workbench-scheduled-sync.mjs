#!/usr/bin/env node
import { budgetedFetch } from './fop-budgeted-fetch.mjs'
import { runAutomaticCatalogues } from './workbench-automatic-catalog.mjs'
// Persistent collected-mode scheduler. No source business writes or credential output.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { prepareTimestampPagedExecution, timestampPreflight } from './workbench-timestamp-sync.mjs'
import { confirmedFopOrigin } from './fop-confirmed-origin.mjs'
import { getToken } from './fop-openapi-smoke.mjs'
import { runQuery, retryAfterMs } from './fop-workbench-openapi.mjs'
import { readSyncConfig, syncScope, syncDatabaseOptions, syncRuntimeRequire } from './workbench-sync-runtime.mjs'
const root = dirname(dirname(fileURLToPath(import.meta.url))), require = createRequire(import.meta.url)
export const ENTITIES = ['hzkj_orders', 'hzkj_alloc_bill', 'hzkj_deliver_bill', 'hzkj_deliver_order']
export const SCHEDULE_LOCK = 'timestamp-scheduled:hyperzone.test:100000'
const MINUTE = 60000
export const readScheduledConfig = readSyncConfig
export function scheduledEnabled(c) {
  return c.FOP_QUERIES_PAUSED === 'false' && c.WORKBENCH_READ_MODE === 'local' && c.WORKBENCH_MOCK_ENABLED !== 'true'
    && ['WORKBENCH_COLLECTED_ENABLED', 'WORKBENCH_AUTOMATIC_CALLS_ENABLED', 'WORKBENCH_SYNC_ENABLED', 'WORKBENCH_TIMESTAMP_SYNC_ENABLED'].every(k => c[k] === 'true')
}
export function scheduledMode(watermark, fullAt, now) {
  return !watermark ? 'initialize' : !fullAt || !Number.isFinite(Date.parse(fullAt)) || now.getTime() - Date.parse(fullAt) >= 86400000 ? 'reconcile' : 'incremental'
}
export function scheduledDue(state, now) {
  if (!state?.nextAttemptAt) return true
  const time = Date.parse(state.nextAttemptAt)
  if (!Number.isFinite(time)) throw Error('timestamp_schedule_invalid')
  return now.getTime() >= time
}
export function scheduledNext(now, failureCount, nextReplicaSync) {
  return new Date(Math.max(nextReplicaSync(now).getTime(), now.getTime() + (failureCount ? Math.min(120, 30 * 2 ** Math.min(failureCount - 1, 3)) * MINUTE : 0))).toISOString()
}
const safeCode = error => /^(timestamp_|fop_queries_paused)[a-z_]*$/.test(error?.message ?? '') ? error.message : 'timestamp_scheduled_failed'
export function scheduledProfile(entityCode, config = {}) {
  return { version: 2, protocol: 'ordinary_modified_pages', ...syncScope(config), entityCode,
    packageVersion: '2026-11-16', readOnly: true, acknowledgeEventualConsistency: true }
}
export function scheduledPreflight(config) {
  let profile
  try {profile=scheduledProfile(ENTITIES[0],config)} catch {return {executable:false,blockedReasons:['timestamp_schedule_scope_invalid'],upstreamCalled:false}}
  const report = timestampPreflight(config, { 'batch-id': 'active-batch-selection', mode: 'scheduled' }, profile)
  if (!scheduledEnabled(config)) report.blockedReasons.push('timestamp_automatic_disabled')
  if (!config.FOP_REPLICA_TENANT_ID || !config.FOP_REPLICA_COMPANY_ID) report.blockedReasons.push('timestamp_schedule_scope_invalid')
  report.executable = report.blockedReasons.length === 0
  return { ...report, automaticCallsEnabled: scheduledEnabled(config), schedule: 'UTC+8; 27 daily slots; missed slots coalesced', entities: ENTITIES }
}
const QUERY_ENTITIES = { 'fulfillment-ids': 'hzkj_orders', 'order-list': 'hzkj_orders', allocation: 'hzkj_alloc_bill', dispatch: 'hzkj_deliver_bill', 'delivery-notice': 'hzkj_deliver_order' }
const SAFE_QUERY_CATEGORIES = new Set(['rate-limit', 'forbidden', 'timeout', 'network-error', 'http-error', 'api-not-subscribed', 'authentication-error', 'configuration-error', 'invalid-request', 'invalid-origin', 'invalid-response', 'invalid-id', 'invalid-json', 'business-error', 'redirect-error', 'response-too-large', 'fop_queries_paused'])
/** Retry one transient read only. No raw payload, URL, exception text or credential reaches diagnostics. */
export async function scheduledPageQuery({ parameters, query, enabled, refreshCredentials, record = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!enabled()) throw Error('fop_queries_paused')
    let result
    try { result = await query() }
    catch (error) {
      record({ entityCode: QUERY_ENTITIES[parameters.operation] ?? 'unknown', pageNo: Number.isSafeInteger(parameters.pageNo) ? parameters.pageNo : null,
        attempt, httpStatus: null, errorCategory: SAFE_QUERY_CATEGORIES.has(error?.category) ? error.category : 'query-error', retryScheduled: false })
      throw error
    }
    const report = result?.report, httpStatus = Number.isInteger(report?.httpStatus) && report.httpStatus >= 100 && report.httpStatus <= 599 ? report.httpStatus : null
    const errorCategory = report?.success === true ? null : SAFE_QUERY_CATEGORIES.has(report?.errorCategory) ? report.errorCategory : 'query-error'
    const transient = report?.success !== true && ((httpStatus === null && ['timeout', 'network-error'].includes(errorCategory))
      || (errorCategory === 'http-error' && httpStatus >= 500 && httpStatus <= 599 && httpStatus !== 519))
    const cooldown=Number.isFinite(report?.retryAfterMs)?Math.max(0,report.retryAfterMs):0
    const unauthorized=report?.success!==true&&(httpStatus===401||errorCategory==='authentication-error')
    const refresh=unauthorized&&attempt===1&&!!refreshCredentials
    const retryScheduled = (transient||refresh) && attempt === 1 && cooldown<=60000
    if (report?.success !== true || attempt > 1) record({ entityCode: QUERY_ENTITIES[parameters.operation] ?? 'unknown',
      pageNo: Number.isSafeInteger(parameters.pageNo) ? parameters.pageNo : null, attempt, httpStatus, errorCategory, retryScheduled })
    if(httpStatus===429||httpStatus===403||unauthorized&&!refresh||httpStatus===503&&cooldown>60000){
      const error=Error(httpStatus===429?'timestamp_source_rate_limited':httpStatus===403?'timestamp_source_forbidden':unauthorized?'timestamp_source_unauthorized':'timestamp_source_unavailable')
      error.retryAfterMs=cooldown;throw error
    }
    if(refresh){
      if(!enabled())throw Error('fop_queries_paused')
      if(!await refreshCredentials())throw Error('timestamp_source_unauthorized')
      continue
    }
    if (!retryScheduled) return result
    await sleep(Math.max(2000,cooldown))
    // Config/stop state is checked again after backoff and again in the shared throttled fetch.
  }
}
/** The durable claim is written before prepare() can authenticate. Global session lock spans all entities. */
export async function runScheduledCycle({ config, db, prepare, runEntity, nextReplicaSync, dueReplicaSync, now = () => new Date(), enabled = () => scheduledEnabled(config), getRequestStats = () => ({ requests: 0, minStartIntervalMs: null }), getEntityDiagnostics = () => [], getSourceBlock = () => null, maintain, runSupplemental }) {
  if (!enabled()) return { status: 'paused', upstreamCalled: false }
  const q = db.createQueryRunner(); let locked = false
  const scope=syncScope(config),lockKey=`timestamp-scheduled:${scope.tenantId}:${scope.companyId}`
  await q.connect()
  try {
    const [lock] = await q.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockKey])
    if (!lock?.acquired) return { status: 'locked', upstreamCalled: false }
    locked = true
    const batches = await q.query("SELECT id,metadata FROM hz_fop_collected_batches WHERE tenant_id=$1 AND company_id=$2 AND state='active'", [scope.tenantId, scope.companyId])
    if (batches.length !== 1) throw Error('timestamp_schedule_batch_ambiguous')
    const batch = batches[0], previous = batch.metadata?.timestampSchedule ?? {}, started = now()
    if(config.NODE_ENV==='production'||config.WORKBENCH_TIMESTAMP_ENVIRONMENT==='production'){
      const persisted=batch.metadata?.deploymentScope
      if(persisted?.environment!=='production'||persisted.orgNumber!==scope.orgNumber||persisted.baseUrl!==confirmedFopOrigin(config))throw Error('timestamp_production_batch_scope_mismatch')
    }
    if (!scheduledDue(previous, started)) return { status: 'not_due', nextAttemptAt: previous.nextAttemptAt, upstreamCalled: false }
    if (!enabled()) return { status: 'paused', upstreamCalled: false }
    const write = async state => {
      const result = await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{timestampSchedule}',$2::jsonb) WHERE id=$1 AND state='active' RETURNING id", [batch.id, JSON.stringify(state)])
      const rows = Array.isArray(result[0]) ? result[0] : result
      if (rows.length !== 1) throw Error('timestamp_batch_scope_changed')
    }
    const entityRetry={...previous.entityRetry}
    if(!runSupplemental&&ENTITIES.every(entity=>Date.parse(entityRetry[entity]?.nextAttemptAt)>started.getTime())){
      const nextAttemptAt=new Date(Math.min(...ENTITIES.map(entity=>Date.parse(entityRetry[entity].nextAttemptAt)))).toISOString()
      await write({...previous,nextAttemptAt})
      return {status:'not_due',nextAttemptAt,upstreamCalled:false}
    }
    const failureCount = Math.min(4, Math.max(0, Number(previous.failureCount) || 0) + 1)
    const state = { version: 1, lastAttemptAt: started.toISOString(), scheduledFor: (dueReplicaSync(started, new Date(started.getTime() - 86400000)) ?? started).toISOString(),
      nextAttemptAt: scheduledNext(started, failureCount, nextReplicaSync), failureCount, entityRetry, lastSuccessfulCycleAt:previous.lastSuccessfulCycleAt??(previous.lastStatus==='succeeded'?previous.lastFinishedAt:null), lastStatus: 'running', entities: [], network: { requests: 0, minStartIntervalMs: null } }
    await write(state)
    let prepared, errorCode,globalFailure=false,cooldownUntil=0
    try {
      if (!enabled()) throw Error('fop_queries_paused')
      prepared = await prepare()
      for (const entityCode of ENTITIES) {
        if (!enabled()) { errorCode = 'fop_queries_paused'; break }
        if(Date.parse(entityRetry[entityCode]?.nextAttemptAt)>now().getTime()){
          state.entities.push({entityCode,status:'backoff',...entityRetry[entityCode]});errorCode??=entityRetry[entityCode].errorCode;continue
        }
        const [checkpoint] = await q.query(`SELECT s.watermark,(SELECT max(finished_at) FROM hz_fop_timestamp_runs r WHERE r.batch_id=$1 AND r.entity_code=$2 AND r.mode IN ('initialize','reconcile') AND r.state IN ('applied','projection_pending')) AS full_at FROM (SELECT 1) base LEFT JOIN hz_fop_timestamp_state s ON s.batch_id=$1 AND s.entity_code=$2`, [batch.id, entityCode])
        const mode = scheduledMode(checkpoint?.watermark, checkpoint?.full_at, now())
        try {
          const result = await runEntity({ batchId: batch.id, tenantId: scope.tenantId, companyId: scope.companyId, entityCode }, mode, prepared)
          state.entities.push({ entityCode, mode, status: result.state, pages: result.pages ?? 0, rows: result.rows ?? 0, changed: result.changed ?? 0, pendingProjection: result.pendingProjection ?? 0 })
          delete entityRetry[entityCode]
        } catch (error) {
          errorCode = getSourceBlock()?.code??safeCode(error)
          state.entities.push({ entityCode, mode, status: 'failed', errorCode })
          const count=Math.min(4,Math.max(0,Number(entityRetry[entityCode]?.count)||0)+1)
          entityRetry[entityCode]={count,errorCode,nextAttemptAt:scheduledNext(now(),count,nextReplicaSync)}
          globalFailure=['timestamp_source_rate_limited','timestamp_source_unauthorized','timestamp_source_forbidden','timestamp_source_unavailable'].includes(errorCode)
          if(globalFailure)cooldownUntil=Math.max(getSourceBlock()?.until??0,now().getTime()+(Number.isFinite(error?.retryAfterMs)?Math.max(0,error.retryAfterMs):0))
        }
        const diagnostics = getEntityDiagnostics(entityCode)
        if (diagnostics.length) state.entities.at(-1).sourceDiagnostics = diagnostics
        // Preserve per-entity evidence even if the process dies before the next entity.
        state.network = getRequestStats()
        await write(state)
        if(globalFailure)break
      }
      if(runSupplemental&&!globalFailure&&enabled()){state.supplemental=await runSupplemental({batchId:batch.id,prepared});if(state.supplemental.catalogues?.some(r=>r.status==='failed'))errorCode??='timestamp_catalogue_incomplete';await write(state)}
    } catch (error) { errorCode = getSourceBlock()?.code??safeCode(error);cooldownUntil=getSourceBlock()?.until??0;globalFailure=true }
    if(maintain){try{state.maintenance={status:'succeeded',...await maintain(q,batch.id)}}catch{state.maintenance={status:'failed',errorCode:'timestamp_retention_failed'}}}
    const finished = now()
    const nextAttemptAt=new Date(Math.max(cooldownUntil,Date.parse(scheduledNext(finished,globalFailure?failureCount:0,nextReplicaSync)))).toISOString()
    Object.assign(state, { lastFinishedAt: finished.toISOString(), network: getRequestStats(), lastStatus: errorCode ? 'failed' : 'succeeded', failureCount: errorCode ? failureCount : 0,
      nextAttemptAt, ...(!errorCode?{lastSuccessfulCycleAt:finished.toISOString()}:{}), ...(errorCode ? { errorCode } : {}) })
    await write(state)
    return { status: state.lastStatus, ...state }
  } finally {
    try { if (locked) await q.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]) } finally { await q.release() }
  }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(a => !['--watch', '--execute'].includes(a))) throw Error('timestamp_invalid_arguments')
  if (!args.length) {
    const config=readScheduledConfig(),report=scheduledPreflight(config)
    if(config.NODE_ENV==='production')try{
      const load=syncRuntimeRequire(config)
      for(const name of ['workbench-replica/replica-schedule','workbench-replica/timestamp-postgres','workbench-replica/timestamp-paged-sync','workbench-replica/timestamp-paged-source','workbench-replica/timestamp-maintenance','fop-data/fop-kingdee.provider'])load(name)
    }catch{report.executable=false;report.blockedReasons.push('timestamp_compiled_runtime_required')}
    console.log(JSON.stringify(report)); return
  }
  const runtime=syncRuntimeRequire(readScheduledConfig())
  const { nextReplicaSync, dueReplicaSync } = runtime('workbench-replica/replica-schedule')
  const { TimestampPostgresStore } = runtime('workbench-replica/timestamp-postgres')
  const { TimestampPagedSync } = runtime('workbench-replica/timestamp-paged-sync')
  const { TimestampPagedSource } = runtime('workbench-replica/timestamp-paged-source')
  const { pruneTimestampPages } = runtime('workbench-replica/timestamp-maintenance')
  const { KingdeeFopDataProvider } = runtime('fop-data/fop-kingdee.provider')
  const { DataSource } = require('typeorm')
  let stopped = false, wake,lastBlockedReport
  const stop = () => { stopped = true; wake?.() }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  const parentPid = process.env.WORKBENCH_SCHEDULE_PARENT_PID
  const parentAlive = () => !parentPid || process.ppid === Number(parentPid)
  do {
    let db
    try {
      const config = readScheduledConfig(), preflight = scheduledPreflight(config)
      if (!parentAlive()) break
      if (!preflight.executable) {
        if (args[0] === '--execute') {console.log(JSON.stringify(preflight));process.exitCode=1}
        else{const message=JSON.stringify({status:'configuration_blocked',blockedReasons:preflight.blockedReasons,upstreamCalled:false});if(message!==lastBlockedReport)console.error(message);lastBlockedReport=message}
      } else {
        lastBlockedReport=undefined
        const enabled = () => !stopped && parentAlive() && scheduledPreflight(readScheduledConfig()).executable
        db = await new DataSource(syncDatabaseOptions(config)).initialize()
        const sharedFetch = budgetedFetch(config)
        let lastRequestAt = 0, requests = 0, minStartIntervalMs = null,sourceBlock=null
        const diagnostics = new Map()
        const record = detail => { const rows = diagnostics.get(detail.entityCode) ?? []; rows.push(detail); diagnostics.set(detail.entityCode, rows.slice(-8)) }
        const guardedFetch = async (...parameters) => {
          if (!enabled()) throw Error('fop_queries_paused')
          if(sourceBlock)throw Error(sourceBlock.code)
          while (lastRequestAt && Date.now() - lastRequestAt < 500) await new Promise(r => setTimeout(r, 500 - (Date.now() - lastRequestAt)))
          if (!enabled()) throw Error('fop_queries_paused')
          const startedAt = Date.now()
          if (lastRequestAt) minStartIntervalMs = Math.min(minStartIntervalMs ?? Infinity, startedAt - lastRequestAt)
          lastRequestAt = startedAt; requests++
          const response=await sharedFetch(...parameters)
          const cooldown=retryAfterMs(response.headers.get('retry-after'))??0
          if(response.status===429||response.headers.get('x-fop-admission')||response.status===503&&cooldown>60000)sourceBlock={code:response.status===429?'timestamp_source_rate_limited':response.status===403?'timestamp_source_forbidden':'timestamp_source_unavailable',until:Date.now()+cooldown}
          return response
        }
        let refreshed=false
        const refreshCredentials=async()=>{
          if(refreshed||['FOP_OPENAPI_CLIENT_ID','FOP_OPENAPI_CLIENT_SECRET','FOP_OPENAPI_USERNAME','FOP_OPENAPI_ACCOUNT_ID'].some(k=>!config[k]))return false
          refreshed=true;delete config.FOP_OPENAPI_ACCESS_TOKEN
          try{config.FOP_OPENAPI_ACCESS_TOKEN=await getToken(config,guardedFetch);return true}catch{throw Error('timestamp_source_unauthorized')}
        }
        const report = await runScheduledCycle({ config, db, enabled, nextReplicaSync, dueReplicaSync, maintain:pruneTimestampPages,getSourceBlock:()=>sourceBlock,getRequestStats: () => ({ requests, minStartIntervalMs }), getEntityDiagnostics: entity => diagnostics.get(entity) ?? [],
          prepare: async () => {
            const provider = new KingdeeFopDataProvider({ get: key => config[key] }, guardedFetch)
            return prepareTimestampPagedExecution(config, scheduledProfile(ENTITIES[0],config), {
              getConnection: () => provider.getConnectionContext(), acquireToken: c => getToken(c, guardedFetch), query: (c, p) => scheduledPageQuery({ parameters: p, enabled, record, refreshCredentials, query: () => runQuery(c, p, guardedFetch) }),
            })
          },
          runSupplemental: ({batchId,prepared})=>runAutomaticCatalogues({config,db,batchId,prepared,enabled,getSourceBlock:()=>sourceBlock}),
          runEntity: async (scope, mode, prepared) => {
            const source = new TimestampPagedSource(scheduledProfile(scope.entityCode,config), () => !enabled(), prepared.query, prepared.identityBasis)
            const result = await new TimestampPagedSync(new TimestampPostgresStore(db), source).run(scope, mode)
            const [counters] = await db.query('SELECT page_count,row_count FROM hz_fop_timestamp_runs WHERE id=$1', [result.runId])
            return { ...result, pages: counters?.page_count, rows: counters?.row_count }
          },
        })
        if (!['not_due', 'paused', 'locked'].includes(report.status) || args[0] === '--execute') console.log(JSON.stringify(report))
        if(args[0]==='--execute'&&report.status==='failed')process.exitCode=1
      }
    } catch (error) { console.error(safeCode(error)); if (args[0] === '--execute') process.exitCode = 1 }
    finally { if (db?.isInitialized) await db.destroy() }
    if (args[0] !== '--watch' || stopped || !parentAlive()) break
    await new Promise(r => { const timer = setTimeout(() => { wake = undefined; r() }, 15000); wake = () => { clearTimeout(timer); wake = undefined; r() } })
  } while (!stopped)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(safeCode(error)); process.exitCode = 1 })
