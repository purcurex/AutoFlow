// Explicit one-shot Chinese-locale capture for orders whose linked store name is missing.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { getToken } from './fop-openapi-smoke.mjs'

const [authorization, outputFlag, directory] = process.argv.slice(2)
if (authorization !== '--authorize-one-shot' || outputFlag !== '--output' || !directory || process.argv.length !== 5) throw Error('explicit_one_shot_output_required')
const env = parseEnv(fs.readFileSync('backend/.env.workbench.local', 'utf8'))
const cfg = parseEnv(fs.readFileSync('backend/.env.fop.local', 'utf8'))
if (env.DB_DATABASE !== 'autoflow_local_demo' || env.DB_PORT !== '55432' || !['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw Error('local_database_required')
if (env.FOP_QUERIES_PAUSED !== 'true' || env.WORKBENCH_SYNC_ENABLED !== 'false' || env.WORKBENCH_AUTOMATIC_CALLS_ENABLED !== 'false') throw Error('persistent_pause_required')
if (cfg.FOP_KINGDEE_TENANT_ID !== 'hyperzone.test' || cfg.FOP_KINGDEE_ORGANIZATION_IDS !== '100000' || cfg.FOP_KINGDEE_USERNAME !== 'limingsong') throw Error('confirmed_identity_required')
// Obtain a fresh zh_CN token; do not reuse a token of unknown locale.
const token = await getToken({ ...cfg, FOP_OPENAPI_ACCESS_TOKEN: '', FOP_QUERIES_PAUSED: 'false' })
fs.mkdirSync(directory, { mode: 0o700 })
const db = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE })
await db.connect()
const manifest = { version: 1, tenantId: 'hyperzone.test', companyId: '100000', language: 'zh_CN', source: 'employee-orders/page', capturedAt: new Date().toISOString(), complete: false, stores: [], targets: [] }
try {
  await db.query('SET default_transaction_read_only=on')
  const batches = (await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id='hyperzone.test' AND company_id='100000'")).rows
  if (batches.length !== 1) throw Error('batch_scope_mismatch')
  manifest.batchId = batches[0].id
  manifest.targets = (await db.query(`SELECT source_id,order_number,raw->'hzkj_shop'->>'id' shop_id,raw->'hzkj_shop'->>'number' shop_number
    FROM hz_fop_collected_orders WHERE batch_id=$1 AND raw->'hzkj_org'->>'id'='100000'
    AND coalesce(display->>'storeName','')='' AND coalesce(raw->'hzkj_shop'->>'name','')=''
    AND raw->'hzkj_shop'->>'id' ~ '^[1-9][0-9]+$' ORDER BY source_id DESC`, [manifest.batchId])).rows
  const samples = new Map()
  for (const row of manifest.targets) if (!samples.has(row.shop_id)) samples.set(row.shop_id, row)
  const headers = { 'Content-Type': 'application/json', [cfg.FOP_OPENAPI_TOKEN_HEADER || 'access_token']: token, 'x-acgw-identity': cfg.FOP_OPENAPI_IDENTITY }
  for (const sample of samples.values()) {
    const query = { scopeRole: 'admin', organizationIds: ['100000'], rawWorkbenchFacts: true, queue: 'review', page: 1, pageSize: 1, afterOrderId: String(BigInt(sample.source_id) - 1n) }
    const response = await fetch('https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/ocbsoc/employee-orders/page', { method: 'POST', headers, body: JSON.stringify({ query }), redirect: 'error', signal: AbortSignal.timeout(20000) })
    const raw = await response.text(), body = JSON.parse(raw), rows = body.data?.items
    const file = `shop-${sample.shop_id}.json`, sha256 = createHash('sha256').update(raw).digest('hex')
    fs.writeFileSync(path.join(directory, file), raw, { mode: 0o600, flag: 'wx' })
    if (!response.ok || body.status !== true || String(body.errorCode) !== '0' || JSON.stringify(body.data.organizationIds) !== '["100000"]' || !Array.isArray(rows) || rows.length !== 1) throw Error('unverified_source_response')
    const source = rows[0]
    if (source.id !== sample.source_id || source.billno !== sample.order_number || source.hzkj_org?.id !== '100000' || source.hzkj_shop?.id !== sample.shop_id) throw Error('source_identity_mismatch')
    const name = source.hzkj_shop.name
    if (typeof name !== 'string' || !name.trim()) throw Error('chinese_locale_name_unavailable')
    manifest.stores.push({ shopId: sample.shop_id, shopNumber: sample.shop_number, name: name.trim(), sourceOrderId: source.id, sourceOrderNumber: source.billno, file, sha256 })
    console.log(JSON.stringify({ shopId: sample.shop_id, name: name.trim() }))
  }
  manifest.complete = true
} catch (error) {
  manifest.error = /^[a-z_]+$/.test(error.message) ? error.message : 'capture_failed'
  process.exitCode = 1
} finally {
  manifest.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
  await db.end()
}
console.log(JSON.stringify({ complete: manifest.complete, stores: manifest.stores.length, orders: manifest.targets.length, error: manifest.error }))
