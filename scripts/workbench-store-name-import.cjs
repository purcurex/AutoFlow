// Offline field-only repair; never requests FOP or changes sync settings.
const fs = require('fs'), path = require('path'), { createHash } = require('crypto'), { parseEnv, isDeepStrictEqual } = require('util')
const sha = value => createHash('sha256').update(value).digest('hex')
function collect(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.version !== 1 || !manifest.complete || manifest.tenantId !== 'hyperzone.test' || manifest.companyId !== '100000' || manifest.language !== 'zh_CN' || manifest.source !== 'employee-orders/page') throw Error('invalid_capture')
  const stores = new Map(), targets = new Set()
  for (const item of manifest.stores) {
    if (!/^[1-9]\d+$/.test(item.shopId) || stores.has(item.shopId) || item.file !== `shop-${item.shopId}.json`) throw Error('invalid_store_capture')
    const raw = fs.readFileSync(path.join(directory, item.file)), body = JSON.parse(raw), rows = body.data?.items
    if (sha(raw) !== item.sha256 || body.status !== true || String(body.errorCode) !== '0' || JSON.stringify(body.data.organizationIds) !== '["100000"]' || !Array.isArray(rows) || rows.length !== 1) throw Error('unverified_response')
    const source = rows[0]
    if (source.id !== item.sourceOrderId || source.billno !== item.sourceOrderNumber || source.hzkj_org?.id !== manifest.companyId || source.hzkj_shop?.id !== item.shopId || source.hzkj_shop?.name?.trim() !== item.name) throw Error('source_identity_mismatch')
    stores.set(item.shopId, { source: manifest.source, language: manifest.language, companyId: manifest.companyId, shopId: item.shopId, name: item.name, sourceOrderId: item.sourceOrderId, sourceOrderNumber: item.sourceOrderNumber, capturedAt: manifest.capturedAt, responseSha256: item.sha256 })
  }
  for (const target of manifest.targets) {
    if (typeof target.source_id !== 'string' || !/^[1-9]\d+$/.test(target.source_id) || !target.order_number || targets.has(target.source_id) || !stores.has(target.shop_id)) throw Error('invalid_target')
    targets.add(target.source_id)
  }
  for (const item of manifest.stores) if (!manifest.targets.some(t => t.source_id === item.sourceOrderId && t.order_number === item.sourceOrderNumber && t.shop_id === item.shopId)) throw Error('unverified_sample')
  return { manifest, stores }
}
async function main() {
  const [mode, directory, reportPath, backupPath] = process.argv.slice(2)
  if (!['--dry-run', '--rehearsal', '--execute'].includes(mode) || !directory || !reportPath || !backupPath) throw Error('explicit_mode_capture_report_backup_required')
  const { manifest, stores } = collect(directory), backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  if (!backup.backupRestoreVerified || sha(fs.readFileSync(backup.backup)) !== backup.sha256) throw Error('verified_backup_required')
  const env = parseEnv(fs.readFileSync('backend/.env.workbench.local', 'utf8'))
  if (env.DB_DATABASE !== 'autoflow_local_demo' || env.DB_PORT !== '55432' || !['127.0.0.1', 'localhost'].includes(env.DB_HOST)) throw Error('local_database_required')
  if (mode === '--rehearsal' && !/^hz_store_restore_\d+$/.test(backup.restoreDatabase)) throw Error('rehearsal_database_required')
  require('ts-node').register({ project: 'backend/tsconfig.json', transpileOnly: true })
  const { supplementStoreName } = require('../backend/src/modules/fop-data/collected-store-name'), { Client } = require('pg')
  const db = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: mode === '--rehearsal' ? backup.restoreDatabase : env.DB_DATABASE })
  const report = { mode, capturedAt: manifest.capturedAt, stores: stores.size, targetOrders: manifest.targets.length, matched: 0, changed: 0, committed: false, upstreamCalled: false, automaticCallsEnabled: false }
  const hash = async () => (await db.query(`SELECT count(*)::int total,md5(string_agg(md5((to_jsonb(o)-ARRAY['display','search_text'])::text || (display-ARRAY['storeName','storeNameZhCN','storeNameCapture'])::text),'' ORDER BY source_id)) other_facts_hash FROM hz_fop_collected_orders o WHERE batch_id=$1`, [manifest.batchId])).rows[0]
  await db.connect()
  try {
    await db.query('BEGIN')
    const batches = (await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id='hyperzone.test' AND company_id='100000' FOR UPDATE")).rows
    if (batches.length !== 1 || batches[0].id !== manifest.batchId) throw Error('batch_scope_mismatch')
    report.before = await hash()
    const rows = (await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) FOR UPDATE', [manifest.batchId, manifest.targets.map(t => t.source_id)])).rows
    const byId = new Map(rows.map(r => [r.source_id, r]))
    for (const target of manifest.targets) {
      const prior = byId.get(target.source_id)
      if (!prior || prior.order_number !== target.order_number) throw Error('target_changed_or_missing')
      const next = supplementStoreName(prior, stores.get(target.shop_id))
      report.matched++
      if (isDeepStrictEqual(prior.display, next.display) && prior.search_text === next.search_text) continue
      await db.query('UPDATE hz_fop_collected_orders SET display=$3::jsonb,search_text=$4 WHERE batch_id=$1 AND source_id=$2', [manifest.batchId, target.source_id, JSON.stringify(next.display), next.search_text])
      report.changed++
    }
    report.after = await hash()
    if (!isDeepStrictEqual(report.before, report.after)) throw Error('unrelated_facts_changed')
    report.storeResults = (await db.query(`SELECT raw->'hzkj_shop'->>'id' shop_id,display->>'storeName' name,count(*)::int orders FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) GROUP BY 1,2 ORDER BY 1`, [manifest.batchId, manifest.targets.map(t => t.source_id)])).rows
    await db.query(mode === '--dry-run' ? 'ROLLBACK' : 'COMMIT')
    report.committed = mode !== '--dry-run'
  } catch (error) {
    await db.query('ROLLBACK'); report.error = error.message; process.exitCode = 1
  } finally { await db.end() }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report))
}
module.exports = { collect }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
