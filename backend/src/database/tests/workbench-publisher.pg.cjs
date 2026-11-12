/* Real PostgreSQL publication tests. Only disposable validation databases are permitted. */
require('reflect-metadata')
require('ts-node').register({ project: 'backend/tsconfig.json', transpileOnly: true })
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto')
const { DataSource } = require('typeorm')
const { ReplicaPublisher } = require('../../modules/workbench-replica/replica-publisher')
const { ReplicaSyncService } = require('../../modules/workbench-replica/replica-sync.service')
const { UnconfiguredReplicaChangeSource } = require('../../modules/workbench-replica/replica-change-contract')
const { ConfigService } = require('@nestjs/config')
const { WORKBENCH_TABLE_COLUMNS } = require('../workbench-schema')
const database = process.env.WORKBENCH_VALIDATION_DATABASE || 'hz_ddl_validation_1794392169018'
assert.match(database, /^hz_ddl_validation_\d+$/)
const ids = Object.fromEntries(['connection', 'company', 'dataset', 'stream', 'document', 'line', 'displayLine', 'membership', 'dependency'].map(key => [key, randomUUID()]))
const other = { company: randomUUID(), dataset: randomUUID(), stream: randomUUID() }
const db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
  password: fs.readFileSync('.runtime/local-demo/database-password', 'utf8').trim() })
const scope = { connectionId: ids.connection, companyId: ids.company, datasetId: ids.dataset }
function group(version, after, member = true, deleted = false) {
  return { groupKey: `commit-${version}`, afterCursor: after, endCursor: `cursor-${version}`, committedAt: '2026-11-11T01:00:00Z', expectedCount: 1,
    events: [{ eventId: `event-${version}`, entityCode: 'hzkj_orders', sourceId: '90071992547409931', sourceVersion: String(version), localDocumentId: ids.document,
      documentNumber: 'TO-PG-TEST', operation: deleted ? 'delete' : 'upsert', linesComplete: true, affectedOrderIds: [ids.document], rows: deleted ? [] : [
        { table: 'hz_fop_fulfillment_orders', values: { document_id: ids.document, entity_code: 'hzkj_orders', raw_order_status: 'paid', total_amount: '10.00' } },
        { table: 'hz_fop_source_lines', values: { id: ids.line, document_id: ids.document, entry_entity: 'entry', source_entry_id: '1', sku_code: 'TEST-SKU', quantity: '1', source_version: String(version) } },
      ] }], projections: [{ orderDocumentId: ids.document, deleted, rows: deleted ? [] : [
      { table: 'hz_fop_workbench_orders', values: { document_id: ids.document, order_kind: 'fulfillment', order_number: 'TO-PG-TEST', readiness: 'ready', published_at: '2026-11-11T01:00:00Z', total_amount: '10', total_quantity: '1' } },
      { table: 'hz_fop_workbench_order_lines', values: { id: ids.displayLine, order_document_id: ids.document, source_line_id: ids.line, sku_code: 'TEST-SKU', quantity: '1' } },
      { table: 'hz_fop_workbench_memberships', values: { id: ids.membership, order_document_id: ids.document, queue_code: 'review', classification_state: member ? 'member' : 'non_member', rule_version: 1 } },
      { table: 'hz_fop_projection_dependencies', values: { id: ids.dependency, order_document_id: ids.document, source_document_id: ids.document, source_version: String(version), relation_revision: '0' } },
    ] }] }
}
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
;(async () => {
  await db.initialize()
  try {
    const residue = await db.query("SELECT c.id connection_id,co.id company_id FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id WHERE c.name='Publisher test' AND c.base_url='https://example.invalid'")
    for (const row of residue) await cleanup(row.company_id, row.connection_id)
    const [owner] = await db.query('SELECT id FROM users ORDER BY id LIMIT 1')
    await db.query("INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES($1,$2,'Publisher test','test','fixture','https://example.invalid','fixture','active')", [ids.connection, owner.id])
    await db.query("INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,name,enabled) VALUES($1,$2,'fixture','fixture','fixture',true)", [ids.company, ids.connection])
    await db.query("INSERT INTO hz_fop_datasets(id,connection_id,company_id,state,validated_at,activated_at) VALUES($1,$2,$3,'active',now(),now())", [ids.dataset, ids.connection, ids.company])
    await db.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1', [ids.company, ids.dataset])
    await db.query("INSERT INTO hz_fop_sync_streams(id,connection_id,company_id,dataset_id,stream_key,state) VALUES($1,$2,$3,$4,'business','ready')", [ids.stream, ids.connection, ids.company, ids.dataset])
    const publisher = new ReplicaPublisher(db)
    const first = group(1, null)
    assert.equal(await publisher.apply(scope, ids.stream, first), 'cursor-1')
    const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key,reorder(item)])) : value
    assert.equal(await publisher.apply(scope, ids.stream, reorder(first)), 'cursor-1')
    assert.equal(await publisher.apply(scope, ids.stream, first), 'cursor-1')
    assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_sync_events WHERE stream_id=$1', [ids.stream]))[0].n, 1)
    const invalid = group(2, 'cursor-1'); invalid.events[0].rows.push({ table: 'users', values: { id: owner.id, role: 'admin' } })
    await assert.rejects(() => publisher.apply(scope, ids.stream, invalid), /Unapproved fact table/)
    assert.equal((await db.query('SELECT applied_cursor FROM hz_fop_sync_streams WHERE id=$1', [ids.stream]))[0].applied_cursor, 'cursor-1')
    assert.equal((await db.query('SELECT source_version FROM hz_fop_source_documents WHERE id=$1', [ids.document]))[0].source_version, '1')
    const collision = group(2, 'cursor-1'); collision.events[0].sourceId = 'wrong-source'
    await assert.rejects(() => publisher.apply(scope, ids.stream, collision), /identity or scope collision/)
    const badDependency = group(2, 'cursor-1'); badDependency.projections[0].rows.find(row => row.table === 'hz_fop_projection_dependencies').values.source_version = '99'
    await assert.rejects(() => publisher.apply(scope, ids.stream, badDependency), /dependency version mismatch/)
    await assert.rejects(() => publisher.apply(scope, ids.stream, group(2, 'cursor-1'), { taskId: randomUUID(), token: '1' }), /lease lost/)
    await publisher.apply(scope, ids.stream, group(2, 'cursor-1', false))
    assert.equal((await db.query('SELECT classification_state FROM hz_fop_workbench_memberships WHERE id=$1', [ids.membership]))[0].classification_state, 'non_member')
    const stale = group(1, 'cursor-2'); stale.groupKey = 'stale'; stale.events[0].eventId = 'stale'
    await assert.rejects(() => publisher.apply(scope, ids.stream, stale), /regressed source version/)
    await publisher.apply(scope, ids.stream, group(3, 'cursor-2', false, true))
    assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_workbench_orders WHERE document_id=$1', [ids.document]))[0].n, 0)
    assert.equal((await db.query('SELECT validation_state FROM hz_fop_source_documents WHERE id=$1', [ids.document]))[0].validation_state, 'deleted')
    assert.equal((await db.query('SELECT applied_cursor FROM hz_fop_sync_streams WHERE id=$1', [ids.stream]))[0].applied_cursor, 'cursor-3')
    assert.equal((await db.query("SELECT applied_watermarks->'_local'->>'projectionRevision' revision FROM hz_fop_datasets WHERE id=$1", [ids.dataset]))[0].revision, '3')
    const resurrect = group(4, 'cursor-3')
    resurrect.events[0].sourceFields = { rawBillStatus: 'C', auditedAt: '2026-11-11T00:45:00Z', relationRevision: '0' }
    await publisher.apply(scope, ids.stream, resurrect)
    assert.equal((await db.query("SELECT applied_watermarks->'_local'->>'projectionRevision' revision FROM hz_fop_datasets WHERE id=$1", [ids.dataset]))[0].revision, '4')
    assert.equal((await db.query("SELECT raw_bill_status FROM hz_fop_source_documents WHERE id=$1", [ids.document]))[0].raw_bill_status, 'C')
    const local = { enabled: true, replicaScope: async () => [scope] }
    const paused = new ReplicaSyncService(db, local, new ConfigService({ FOP_QUERIES_PAUSED: 'true' }), new UnconfiguredReplicaChangeSource(), publisher)
    const blocked = await Promise.all([paused.request(owner.id, 'blocked'), paused.request(owner.id, 'blocked')])
    assert.equal(blocked[0].id, blocked[1].id)
    assert.equal(blocked[0].state, 'blocked')
    assert.equal(blocked[0].errorCode, 'fop_queries_paused')
    assert.equal((await paused.status(owner.id)).sourceSyncedAt, null)
    await db.query("UPDATE hz_fop_sync_streams SET source_scope_version='v1' WHERE id=$1", [ids.stream])
    let pages = 0
    const source = { isConfigured: () => true,
      barrier: async () => ({ id: randomUUID(), scopeVersion: 'v1', sourceAsOf: new Date(Date.now()-1000).toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), targetVector: { business: 'cursor-6' }, proof: { fixture: true } }),
      groups: async (_scope, _key, after) => { pages++; return after === 'cursor-4' ? [group(5, 'cursor-4')] : after === 'cursor-5' ? [group(6, 'cursor-5', false)] : [] } }
    const sync = new ReplicaSyncService(db, local, new ConfigService({ FOP_QUERIES_PAUSED: 'false' }), source, publisher)
    const pending = await sync.request(owner.id, 'catch-up')
    assert.equal(pending.state, 'pending')
    await sync.tick()
    assert.equal((await sync.job(owner.id, pending.id)).state, 'succeeded')
    assert.equal(pages, 2)
    assert.ok((await sync.status(owner.id)).sourceSyncedAt)
    const olderSource = { ...source, barrier: async () => ({ ...(await source.barrier()), id: randomUUID(), targetVector: { business: 'cursor-5' } }),
      groups: async () => { throw new Error('A covered older barrier must not query backwards') } }
    const olderSync = new ReplicaSyncService(db, local, new ConfigService({ FOP_QUERIES_PAUSED: 'false' }), olderSource, publisher)
    const older = await olderSync.request(owner.id, 'older-barrier')
    for (let i=0;i<3 && (await olderSync.job(owner.id,older.id)).state!=='succeeded';i++) await olderSync.tick()
    assert.equal((await olderSync.job(owner.id,older.id)).state, 'succeeded')
    // Force both companies to observe an absent shared UUID before either INSERT.
    await db.query("INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,name,enabled) VALUES($1,$2,'other','other','other',true)", [other.company, ids.connection])
    await db.query("INSERT INTO hz_fop_datasets(id,connection_id,company_id,state,validated_at,activated_at) VALUES($1,$2,$3,'active',now(),now())", [other.dataset, ids.connection, other.company])
    await db.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1', [other.company, other.dataset])
    await db.query("INSERT INTO hz_fop_sync_streams(id,connection_id,company_id,dataset_id,stream_key,state) VALUES($1,$2,$3,$4,'business','ready')", [other.stream, ids.connection, other.company, other.dataset])
    const sharedId = randomUUID(); let arrivals = 0, release
    const gate = new Promise(resolve => { release = resolve })
    const guarded = { createQueryRunner() {
      const runner = db.createQueryRunner(), execute = runner.query.bind(runner)
      runner.query = async (sql, parameters, ...rest) => {
        const result = await execute(sql, parameters, ...rest)
        if (sql.startsWith('SELECT connection_id,company_id,dataset_id,entity_code,source_id') && parameters[0] === sharedId) { if (++arrivals === 2) release(); await gate }
        return result
      }; return runner
    } }
    function raceGroup(after, suffix) {
      let value = JSON.stringify(group(1, after))
      for (const key of ['document','line','displayLine','membership','dependency']) value = value.replaceAll(ids[key], key === 'document' ? sharedId : randomUUID())
      const parsed = JSON.parse(value); parsed.groupKey = 'race-'+suffix; parsed.endCursor = 'race-'+suffix; parsed.events[0].eventId = 'race-'+suffix; parsed.events[0].sourceId = 'race-source'
      return parsed
    }
    const concurrentPublisher = new ReplicaPublisher(guarded)
    const results = await Promise.allSettled([concurrentPublisher.apply(scope, ids.stream, raceGroup('cursor-6','a')),
      concurrentPublisher.apply({ connectionId: ids.connection, companyId: other.company, datasetId: other.dataset }, other.stream, raceGroup(null,'b'))])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    assert.match(results.find(result => result.status === 'rejected').reason.message, /identity or scope collision/)
    console.log(JSON.stringify({ database, status: 'passed', scenarios: ['atomic publication', 'idempotent replay', 'rollback and whitelist', 'membership removal', 'version regression rejection', 'delete tombstone', 'durable revision', 'source timestamps', 'dependency mismatch', 'lease fencing', 'durable paused request', 'concurrent request idempotency', 'paged barrier catch-up', 'covered older barrier', 'concurrent first-insert scope isolation'] }))
  } finally { try { await cleanup(other.company); await cleanup() } finally { await db.destroy() } }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
