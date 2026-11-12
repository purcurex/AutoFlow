import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { LocalWorkbenchService } from './local-workbench.service'
import { REPLICA_CHANGE_SOURCE, type ReplicaChangeSource, type ReplicaDatasetScope } from './replica-change-contract'
import { replicaReadiness } from './replica-readiness'
import { ReplicaPublisher } from './replica-publisher'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { dueReplicaSync, nextReplicaSync } from './replica-schedule'
import { REPLICA_NAVIGATION_MIN_INTERVAL_SECONDS, replicaScopeLock, type ReplicaSyncTrigger } from './replica-sync-policy'

type Row = Record<string, any>
const iso = (value: string | Date | null | undefined) => value ? new Date(value).toISOString() : null
const fail = (code: string) => new ServiceUnavailableException({ code, message: code })
// PostgresQueryRunner returns [rows, affected] for UPDATE RETURNING.
const mutationRows = (result: Row[] | [Row[], number]): Row[] => Array.isArray(result[0]) ? result[0] : result as Row[]

@Injectable()
export class ReplicaSyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private working = false
  private started = false
  private readonly logger = new Logger(ReplicaSyncService.name)
  constructor(private readonly db: DataSource, private readonly local: LocalWorkbenchService,
    private readonly config: ConfigService, @Inject(REPLICA_CHANGE_SOURCE) private readonly source: ReplicaChangeSource,
    private readonly publisher: ReplicaPublisher, @Optional() private readonly authorization?: ReplicaAuthorizationService) {}

  private get paused() { return this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase() === 'true' }
  private get automaticCallsEnabled() { return this.config.get<string>('WORKBENCH_AUTOMATIC_CALLS_ENABLED') !== 'false' }
  private assertSource() {
    if (this.paused || this.local.mock) throw fail('fop_queries_paused')
    if (!this.source.isConfigured()) throw fail('workbench_replica_sync_not_configured')
  }

  onModuleInit() {
    this.started = true
    if (this.automaticCallsEnabled && this.local.enabled && !this.local.mock && !this.paused && this.source.isConfigured()) {
      this.timer = setInterval(() => { void this.tick().catch(() => this.logger.error('Replica worker failed; durable tasks remain retryable')) }, 15_000)
      this.timer.unref()
    }
  }
  onModuleDestroy() { this.started = false; if (this.timer) clearInterval(this.timer) }

  private readiness(initialized: boolean) {
    return replicaReadiness({ local: this.local.enabled, mock: this.local.mock, paused: this.paused, initialized, sourceConfigured: this.source.isConfigured() })
  }

  async status(userId: string) {
    if(this.local.enabled){const collected=await this.local.collectedStatus?.(userId);if(collected)return {...collected,capabilities:this.readiness(false)}}
    if (!this.local.enabled) return { capabilities: this.readiness(false), syncConfigured: this.source.isConfigured(), readMode: 'live', initialized: false, state: 'ready', paused: this.paused, sourceSyncedAt: null, nextScheduledAt: null, datasetId: null, revision: null }
    let scopes: Awaited<ReturnType<LocalWorkbenchService['replicaScope']>>
    try { scopes = await this.local.replicaScope(userId) } catch (error) { if ((error as Row).code !== '42P01') throw error; scopes = [] }
    const initialized = scopes.length > 0 && scopes.every(scope => scope.datasetId)
    const scheduled = this.automaticCallsEnabled && initialized && !this.paused && this.source.isConfigured() && this.config.get<string>('WORKBENCH_SYNC_ENABLED') === 'true'
    const base = { capabilities: this.readiness(initialized), automaticCallsEnabled: this.automaticCallsEnabled, syncConfigured: this.source.isConfigured(), navigationMinIntervalSeconds: REPLICA_NAVIGATION_MIN_INTERVAL_SECONDS, readMode: 'local', initialized, paused: this.paused, sourceSyncedAt: null as string | null, nextScheduledAt: scheduled ? nextReplicaSync(new Date()).toISOString() : null, datasetId: initialized ? scopes.map(scope => scope.datasetId).join(':') : null, revision: null as string | null }
    if(this.local.mock){
      const fixtures:Row[]=initialized?await this.db.query("SELECT applied_watermarks->'mock'->>'generatedAt' generated_at FROM hz_fop_datasets WHERE id=ANY($1::uuid[])",[scopes.map(scope=>scope.datasetId)]):[]
      return {...base,dataMode:'mock',state:initialized?'ready':'not_initialized',mockGeneratedAt:fixtures[0]?.generated_at??null,syncConfigured:false,nextScheduledAt:null}
    }
    if (!initialized) return { ...base, state: 'not_initialized' }
    const companyIds = scopes.map(scope => scope.companyId)
    const rows: Row[] = await this.db.query(`SELECT c.id,d.state,d.validated_at,d.activated_at,
      (SELECT max(source_as_of) FROM hz_fop_sync_barriers b WHERE b.company_id=c.id AND b.dataset_id=d.id AND b.state='satisfied' AND b.purpose IN ('manual_refresh','bootstrap_cutover')) AS source_as_of,
      COALESCE(d.applied_watermarks->'_local'->>'projectionRevision','0') AS revision
      FROM hz_fop_companies c JOIN hz_fop_datasets d ON d.id=c.active_dataset_id AND d.company_id=c.id WHERE c.id=ANY($1::uuid[])`, [companyIds])
    if (rows.length !== scopes.length || rows.some(row => row.state !== 'active' || !row.validated_at || !row.activated_at)) return { ...base, capabilities: this.readiness(false), initialized: false, state: 'not_initialized' }
    base.sourceSyncedAt = rows.every(row => row.source_as_of) ? new Date(Math.min(...rows.map(row => new Date(row.source_as_of).getTime()))).toISOString() : null
    base.revision = rows.map(row => `${row.id}:${row.revision ?? '0'}`).sort().join('|')
    const jobs: Row[] = await this.db.query("SELECT state FROM hz_fop_sync_runs WHERE company_id=ANY($1::uuid[]) AND dataset_id=ANY($2::uuid[]) AND state IN ('pending','running') LIMIT 1", [companyIds, scopes.map(scope => scope.datasetId)])
    const latest: Row[] = await this.db.query('SELECT DISTINCT ON (company_id,dataset_id) state FROM hz_fop_sync_runs WHERE company_id=ANY($1::uuid[]) AND dataset_id=ANY($2::uuid[]) ORDER BY company_id,dataset_id,created_at DESC,id DESC', [companyIds, scopes.map(scope => scope.datasetId)])
    return { ...base, state: this.paused ? 'paused' : jobs.length ? 'syncing' : latest.some(row => ['failed','partial'].includes(row.state)) ? 'failed' : 'ready', syncConfigured: this.source.isConfigured() }
  }

  async request(userId: string, requestKey: string, trigger: ReplicaSyncTrigger = 'manual') {
    const authorized = await this.local.replicaScope(userId)
    if (trigger !== 'manual' && !this.automaticCallsEnabled) return { id: null, state: 'skipped', reason: 'workbench_automatic_calls_disabled' }
    const scopes = authorized.filter(scope => trigger !== 'scheduled' || scope.datasetId).sort((a, b) => a.companyId.localeCompare(b.companyId))
    if (!this.local.enabled || !scopes.length || scopes.some(scope => !scope.datasetId)) throw fail('workbench_replica_not_initialized')
    const errorCode = this.paused || this.local.mock ? 'fop_queries_paused' : !this.source.isConfigured() ? 'workbench_replica_sync_not_configured' : null
    if (trigger === 'navigation' && errorCode) return { id: null, state: 'skipped', reason: errorCode }
    const result = await this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`refresh:${userId}:${requestKey}`])
      const prior: Row[] = await manager.query("SELECT requested_scope->>'batchId' AS batch_id FROM hz_fop_refresh_requests WHERE actor_account_id=$1 AND request_key=ANY($2::text[]) LIMIT 1", [userId, scopes.map(scope => `${requestKey}:${scope.companyId}`)])
      if (prior.length) return prior[0].batch_id as string
      let first = ''
      for (const scope of scopes) {
        const values = [scope.connectionId, scope.companyId, scope.datasetId]
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [replicaScopeLock({ ...scope, datasetId: scope.datasetId! })])
        // Manual requests share an unstarted run. A running run's barrier may predate this request.
        const shared: Row[] = errorCode ? [] : await manager.query(`SELECT id,state FROM hz_fop_sync_runs WHERE connection_id=$1 AND company_id=$2 AND dataset_id=$3
          AND (state='pending' OR ($4 AND state='running')) ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,created_at LIMIT 1`, [...values, trigger === 'navigation'])
        if (!shared.length && trigger === 'navigation') {
          const recent: Row[] = await manager.query(`SELECT id FROM hz_fop_sync_runs WHERE connection_id=$1 AND company_id=$2 AND dataset_id=$3
            AND COALESCE(started_at,created_at)>now()-($4 * interval '1 second') LIMIT 1`, [...values, REPLICA_NAVIGATION_MIN_INTERVAL_SECONDS])
          if (recent.length) continue
        }
        const id = randomUUID(), runId = shared[0]?.id ?? randomUUID()
        if (!first) first = id
        if (!shared.length) await manager.query(`INSERT INTO hz_fop_sync_runs(id,connection_id,company_id,dataset_id,trigger_type,state,last_error_code,finished_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [runId, ...values, trigger === 'navigation' ? 'navigation' : 'manual', errorCode ? 'failed' : 'pending', errorCode, errorCode ? new Date() : null])
        await manager.query(`INSERT INTO hz_fop_refresh_requests(id,connection_id,company_id,dataset_id,actor_account_id,sync_run_id,request_key,requested_scope,state,error_code,finished_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [id, ...values, userId, runId, `${requestKey}:${scope.companyId}`, JSON.stringify({ batchId: first, trigger, mode: 'all_authorized_company_changes', includesRemovals: true }), errorCode ? 'failed' : shared[0]?.state === 'running' ? 'syncing' : 'pending_barrier', errorCode, errorCode ? new Date() : null])
        if (!errorCode && !shared.length) await manager.query(`INSERT INTO hz_fop_sync_tasks(id,connection_id,company_id,dataset_id,task_type,target_key,payload)
          VALUES($1,$2,$3,$4,'reconcile',$5,$6::jsonb)`, [randomUUID(), ...values, `refresh:${id}`, JSON.stringify({ refreshRequestId: id, runId })])
      }
      return first || null
    })
    // Only the initialized worker may be kicked. Unit/PG tests can drive tick explicitly.
    if (result && !errorCode && this.timer) void this.tick().catch(() => this.logger.error('Replica worker failed; durable tasks remain retryable'))
    return result ? this.job(userId, result) : { id: null, state: 'skipped', reason: 'cooldown' }
  }

  async job(userId: string, id: string) {
    const scopes = await this.local.replicaScope(userId)
    const rows: Row[] = await this.db.query(`SELECT * FROM hz_fop_refresh_requests WHERE actor_account_id=$1 AND requested_scope->>'batchId'=$2 ORDER BY requested_at,id`, [userId, id])
    if (!rows.length) throw new NotFoundException('Sync request not found')
    if (rows.some(row => !scopes.some(scope => scope.connectionId === row.connection_id && scope.companyId === row.company_id && scope.datasetId === row.dataset_id))) return { id, state: 'failed', errorCode: 'workbench_scope_changed' }
    const bad = rows.find(row => ['failed','scope_changed','cancelled'].includes(row.state))
    // In manual-only mode an explicit request/poll drives only this authorized batch.
    // No timer, navigation or old retry queue can start unrelated upstream calls.
    if (!bad && !this.automaticCallsEnabled && this.started && rows.some(row => ['pending_barrier','syncing'].includes(row.state))) {
      void this.tick({ actorAccountId: userId, batchId: id }).catch(() => this.logger.error('Requested replica batch failed'))
    }
    return { id, state: bad ? ['fop_queries_paused','workbench_replica_sync_not_configured'].includes(bad.error_code) ? 'blocked' : 'failed' : rows.every(row => row.state === 'succeeded') ? 'succeeded' : rows.some(row => row.state === 'syncing') ? 'running' : 'pending', ...(bad ? { errorCode: bad.error_code ?? bad.state } : {}) }
  }

  /** Source adapters are explicitly registered; enabling a flag alone cannot turn legacy APIs into a reliable feed. */
  async tick(manualBatch?: { actorAccountId: string; batchId: string }) {
    if ((!this.automaticCallsEnabled && !manualBatch) || this.working || !this.local.enabled || this.local.mock || this.paused || !this.source.isConfigured()) return
    this.working = true
    try {
      if (!manualBatch && this.automaticCallsEnabled && this.config.get<string>('WORKBENCH_SYNC_ENABLED') === 'true') await this.enqueueDue()
      const task = await this.db.transaction(async manager => {
        const [candidate]: Row[] = await manager.query(`SELECT t.* FROM hz_fop_sync_tasks t WHERE task_type='reconcile' AND target_key LIKE 'refresh:%' AND
          (state IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=now()) OR state='running' AND lease_expires_at<now())
          ${manualBatch ? `AND EXISTS (SELECT 1 FROM hz_fop_refresh_requests explicit_request WHERE explicit_request.sync_run_id::text=t.payload->>'runId'
            AND explicit_request.actor_account_id=$1 AND explicit_request.requested_scope->>'batchId'=$2 AND explicit_request.requested_scope->>'trigger'='manual')` : ''}
          AND NOT EXISTS(SELECT 1 FROM hz_fop_sync_tasks other WHERE other.dataset_id=t.dataset_id AND other.company_id=t.company_id AND other.connection_id=t.connection_id
            AND other.id<>t.id AND other.state='running' AND other.lease_expires_at>now())
          ORDER BY priority,created_at FOR UPDATE SKIP LOCKED LIMIT 1`, manualBatch ? [manualBatch.actorAccountId, manualBatch.batchId] : [])
        if (!candidate) return null
        const scope = { connectionId: candidate.connection_id, companyId: candidate.company_id, datasetId: candidate.dataset_id }
        const [locked]: Row[] = await manager.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [replicaScopeLock({ ...scope, datasetId: scope.datasetId! })])
        if (!locked.acquired) return null
        // New statement after the advisory lock observes a competing worker's committed claim.
        const running: Row[] = await manager.query("SELECT id FROM hz_fop_sync_tasks WHERE connection_id=$1 AND company_id=$2 AND dataset_id=$3 AND id<>$4 AND state='running' AND lease_expires_at>now() LIMIT 1", [candidate.connection_id,candidate.company_id,candidate.dataset_id,candidate.id])
        if (running.length) return null
        const [claimed] = mutationRows(await manager.query(`UPDATE hz_fop_sync_tasks SET state='running',lease_token=lease_token+1,lease_owner=$2,lease_expires_at=now()+interval '90 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *`, [candidate.id, `worker:${process.pid}`]))
        await manager.query("UPDATE hz_fop_sync_runs SET state='running',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1", [claimed.payload.runId])
        return claimed
      })
      if (task) await this.process(task)
    } finally { this.working = false }
  }

  private async enqueueDue() {
    const now = new Date()
    const owners: Row[] = await this.db.query(`SELECT c.workspace_owner_id,min(latest.scheduled_for) AS last_scheduled
      FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id
      LEFT JOIN LATERAL (SELECT max(scheduled_for) AS scheduled_for FROM hz_fop_sync_runs r WHERE r.company_id=co.id AND r.dataset_id=co.active_dataset_id) latest ON TRUE
      WHERE c.status='active' AND co.enabled AND co.active_dataset_id IS NOT NULL GROUP BY c.workspace_owner_id`)
    for (const owner of owners) {
      const slot = dueReplicaSync(now, owner.last_scheduled ? new Date(owner.last_scheduled) : new Date(now.getTime() - 86400_000))
      if (!slot) continue
      const key = `scheduled:${slot.toISOString()}`, hour = new Date(slot.getTime() + 8 * 3600_000).getUTCHours()
      try {
        await this.request(owner.workspace_owner_id, key, 'scheduled')
      } catch {
        this.logger.warn('Scheduled replica scope unavailable; other workspaces and queued tasks continue')
        continue
      }
      await this.db.query(`UPDATE hz_fop_sync_runs r SET trigger_type=$1,scheduled_for=$2 WHERE EXISTS(SELECT 1 FROM hz_fop_refresh_requests q WHERE q.sync_run_id=r.id AND q.actor_account_id=$3 AND q.request_key LIKE $4) AND (r.scheduled_for IS NULL OR r.scheduled_for<$2)`, [hour === 8 ? 'scheduled_morning' : hour >= 9 && hour <= 18 ? 'scheduled_business' : 'scheduled_off_hours', slot, owner.workspace_owner_id, `${key}:%`])
    }
  }

  private async renew(task: Row) {
    this.assertSource()
    const rows = mutationRows(await this.db.query("UPDATE hz_fop_sync_tasks SET lease_expires_at=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_expires_at>now() RETURNING id", [task.id, task.lease_token]))
    if (!rows.length) throw new Error('Replica lease lost')
  }

  private async process(task: Row) {
    const scope: ReplicaDatasetScope = { connectionId: task.connection_id, companyId: task.company_id, datasetId: task.dataset_id }
    const runId = task.payload.runId
    try {
      await this.renew(task)
      await this.db.query("UPDATE hz_fop_refresh_requests SET state='syncing' WHERE sync_run_id=$1", [runId])
      await this.db.query("UPDATE hz_fop_sync_runs SET state='running',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1", [runId])
      const barrier = await this.source.barrier(scope)
      await this.renew(task)
      if (!barrier.id || !barrier.scopeVersion || !Object.keys(barrier.targetVector).length || !Object.keys(barrier.proof).length || !iso(barrier.sourceAsOf) || Date.parse(barrier.expiresAt) <= Date.now() || Date.parse(barrier.sourceAsOf) > Date.now()) throw new Error('Invalid source barrier proof')
      const barrierId = randomUUID()
      await this.db.query(`INSERT INTO hz_fop_sync_barriers(id,connection_id,company_id,dataset_id,sync_run_id,source_barrier_id,purpose,scope_version,target_vector,capture_proof,source_as_of,expires_at,state)
        VALUES($1,$2,$3,$4,$5,$6,'manual_refresh',$7,$8::jsonb,$9::jsonb,$10,$11,'catching_up')`, [barrierId, ...Object.values(scope), runId, barrier.id, barrier.scopeVersion, JSON.stringify(barrier.targetVector), JSON.stringify(barrier.proof), barrier.sourceAsOf, barrier.expiresAt])
      await this.db.query('UPDATE hz_fop_refresh_requests SET barrier_id=$2,target_watermarks=$3::jsonb WHERE sync_run_id=$1', [runId, barrierId, JSON.stringify(barrier.targetVector)])
      for (const [key, target] of Object.entries(barrier.targetVector)) {
        const [stream]: Row[] = await this.db.query('SELECT * FROM hz_fop_sync_streams WHERE connection_id=$1 AND company_id=$2 AND dataset_id=$3 AND stream_key=$4', [...Object.values(scope), key])
        if (!stream || stream.source_scope_version !== barrier.scopeVersion) throw new Error('Source stream scope changed')
        let after: string | null = stream.applied_cursor
        while (!await this.covered(stream.id, target)) {
          await this.renew(task)
          const groups = await this.source.groups(scope, key, after, target)
          if (!groups.length || groups.length > 100) throw new Error('Invalid bounded source page')
          for (const group of groups) {
            await this.renew(task)
            if (Date.parse(barrier.expiresAt) <= Date.now()) throw new Error('Source barrier expired')
            after = await this.publisher.apply(scope, stream.id, group, { taskId: task.id, token: String(task.lease_token) })
          }
        }
        if (!await this.covered(stream.id, target)) throw new Error('Source barrier not reached')
      }
      // Manual-only mode never renews proof from ordinary list reads. Renew it as
      // part of this explicitly authorized batch after its source changes apply.
      if (!this.automaticCallsEnabled) {
        if (!this.authorization) throw fail('workbench_replica_authorization_unavailable')
        await this.authorization.refresh(scope)
      }
      await this.renew(task)
      await this.db.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [replicaScopeLock({ ...scope, datasetId: scope.datasetId! })])
        const fences: Row[] = await manager.query("SELECT id FROM hz_fop_sync_tasks WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_expires_at>now() FOR UPDATE", [task.id, task.lease_token])
        if (!fences.length || Date.parse(barrier.expiresAt) <= Date.now()) throw new Error('Replica lease or barrier expired')
        await manager.query("UPDATE hz_fop_sync_barriers SET state='satisfied',satisfied_at=now(),updated_at=now() WHERE id=$1", [barrierId])
        await manager.query("UPDATE hz_fop_refresh_requests SET state='succeeded',finished_at=now(),error_code=NULL,barrier_id=$2,target_watermarks=$3::jsonb WHERE sync_run_id=$1", [runId,barrierId,JSON.stringify(barrier.targetVector)])
        await manager.query("UPDATE hz_fop_sync_runs SET state='succeeded',target_watermarks=$2::jsonb,achieved_watermarks=$2::jsonb,finished_at=now(),updated_at=now() WHERE id=$1", [runId, JSON.stringify(barrier.targetVector)])
        await manager.query("UPDATE hz_fop_sync_tasks SET state='succeeded',lease_expires_at=NULL,updated_at=now() WHERE id=$1", [task.id])
      })
    } catch (error) {
      const code = (error as Row).response?.code ?? 'workbench_replica_sync_failed'
      await this.db.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [replicaScopeLock({ ...scope, datasetId: scope.datasetId! })])
        const fences: Row[] = await manager.query("SELECT id FROM hz_fop_sync_tasks WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE", [task.id, task.lease_token])
        if (!fences.length) return
        await manager.query("UPDATE hz_fop_sync_tasks SET state='failed',last_error_code=$2,lease_expires_at=NULL,updated_at=now() WHERE id=$1", [task.id, code])
        await manager.query("UPDATE hz_fop_refresh_requests SET state='failed',error_code=$2,finished_at=now() WHERE sync_run_id=$1", [runId, code])
        await manager.query("UPDATE hz_fop_sync_runs SET state='failed',last_error_code=$2,finished_at=now(),updated_at=now() WHERE id=$1", [runId, code])
      })
      this.logger.warn(`Replica sync failed (${code}); applied cursors are preserved`)
    }
  }

  private async covered(streamId: string, target: string): Promise<boolean> {
    const [row]: Row[] = await this.db.query(`SELECT (s.applied_cursor=$2 OR EXISTS(SELECT 1 FROM hz_fop_sync_commit_groups g WHERE g.stream_id=s.id AND g.end_cursor=$2 AND g.state='applied')) AS covered FROM hz_fop_sync_streams s WHERE s.id=$1`, [streamId,target])
    return row?.covered === true
  }
}
