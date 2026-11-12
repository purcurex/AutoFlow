#!/usr/bin/env node
// Local operator diagnostic. Read-only, aggregate only; never starts the app or contacts FOP.
const fs = require('node:fs'), path = require('node:path'), { parseEnv } = require('node:util'), { Client } = require('pg')
const root = path.resolve(__dirname, '..')
require('ts-node').register({ project: path.join(root, 'backend/tsconfig.json'), transpileOnly: true })
const { diagnoseCoverage } = require('../backend/src/modules/workbench-replica/workbench-coverage')
async function main() {
  const args = process.argv.slice(2), options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--env-file','--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error('Invalid arguments')
    options[args[i]] = args[i + 1]
  }
  if (!options['--env-file']) throw Error('An explicit local environment file is required')
  const env = parseEnv(fs.readFileSync(path.resolve(options['--env-file']), 'utf8'))
  if (!['127.0.0.1','localhost','::1'].includes(env.DB_HOST) || !/^(autoflow_local_demo|autoflow_workbench_mock|hz_ddl_validation_\d+)$/.test(env.DB_DATABASE || '')) throw Error('Only named local databases can be inspected')
  const client = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE, connectionTimeoutMillis: 5000 })
  await client.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout='30s'")
    const datasets = (await client.query("SELECT count(*)::int AS n FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id JOIN hz_fop_datasets ds ON ds.id=co.active_dataset_id AND ds.company_id=co.id WHERE c.status='active' AND co.enabled AND ds.state='active'")).rows[0].n
    const rows = (await client.query(`SELECT o.cancelled, f.raw_delivery_status, f.raw_refund_status, o.allocation_created,
      o.stock_readiness_state, o.allocation_review_state, o.intercept_status,
      (o.readiness='ready' AND o.published_at IS NOT NULL AND sd.validation_state='verified'
        AND NOT EXISTS(SELECT 1 FROM hz_fop_workbench_order_lines l WHERE l.order_document_id=o.document_id AND l.dataset_id=o.dataset_id AND l.projection_revision<>o.projection_revision)) AS ready,
      COALESCE((SELECT jsonb_object_agg(m.queue_code, CASE WHEN m.projection_revision=o.projection_revision AND m.rule_version=o.rule_version THEN m.classification_state ELSE 'unknown' END)
        FROM hz_fop_workbench_memberships m WHERE m.order_document_id=o.document_id AND m.company_id=o.company_id AND m.dataset_id=o.dataset_id), '{}'::jsonb) AS memberships
      FROM hz_fop_workbench_orders o
      JOIN hz_fop_source_documents sd ON sd.id=o.document_id AND sd.company_id=o.company_id AND sd.dataset_id=o.dataset_id
      JOIN hz_fop_companies co ON co.id=o.company_id AND co.connection_id=o.connection_id AND co.active_dataset_id=o.dataset_id AND co.enabled
      JOIN hz_fop_connections c ON c.id=o.connection_id AND c.status='active'
      JOIN hz_fop_datasets ds ON ds.id=o.dataset_id AND ds.company_id=o.company_id AND ds.state='active'
      LEFT JOIN hz_fop_fulfillment_orders f ON f.document_id=o.document_id AND f.company_id=o.company_id AND f.dataset_id=o.dataset_id
      WHERE o.order_kind='fulfillment' AND sd.deleted_at IS NULL`)).rows
    const counts = { potentially_actionable: 0, uncovered: 0, unknown: 0, terminal: 0, completed: 0 }
    const reasons = {}, queueMemberships = {}, unknownQueues = {}
    let regularGaps = 0
    for (const row of rows) {
      const result = diagnoseCoverage({ cancelled: row.cancelled, rawDeliveryStatus: row.raw_delivery_status, ready: row.ready,
        memberships: row.memberships, allocationCreated: row.allocation_created, stockReadiness: row.stock_readiness_state,
        allocationReview: row.allocation_review_state, intercepted: row.intercept_status === 'intercepted', refunded: ['partial_refunded','refunded'].includes(row.raw_refund_status) })
      counts[result.state]++
      if (['uncovered','unknown'].includes(result.state) && result.regularGap) regularGaps++
      for (const q of result.queues) queueMemberships[q] = (queueMemberships[q] || 0) + 1
      for (const q of result.unknownQueues) unknownQueues[q] = (unknownQueues[q] || 0) + 1
      if (result.state === 'uncovered') for (const reason of result.reasons) reasons[reason] = (reasons[reason] || 0) + 1
    }
    const report = { checkedAt: new Date().toISOString(), readOnly: true, fopContacted: false, database: env.DB_DATABASE,
      scope: 'All active local company datasets; operator-only aggregate diagnostic, not a user authorization grant',
      state: datasets ? 'projection_audited' : 'not_initialized', activeDatasets: datasets, fulfillmentOrders: rows.length,
      counts: datasets ? counts : null, regularGaps: datasets ? regularGaps : null, reasons, queueMemberships, unknownQueues,
      actualVisibleGapCount: null,
      limitation: 'Potential membership does not prove current screen visibility: resource grants, linked-document predicates, list completeness and account scope still apply. No datasets means unmeasured, not zero missing orders.' }
    await client.query('ROLLBACK')
    if (options['--output']) fs.writeFileSync(path.resolve(options['--output']), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
  } finally { await client.end() }
}
main().catch(() => { console.error('Coverage audit failed; check local configuration and schema. No FOP requests or business writes were made.'); process.exitCode = 1 })
