#!/usr/bin/env node
// Explicit, read-only supplemental capture. Persistent pause settings are never changed.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { runQuery, modificationWindowOperations } from './fop-workbench-openapi.mjs'
import { getToken } from './fop-openapi-smoke.mjs'

export const operations = Object.freeze({ fulfillment: 'order-list', stock: 'stock', purchase: 'purchase', dispatch: 'dispatch', receipt: 'receipt' })
const sha = value => createHash('sha256').update(value).digest('hex')
export function validateAnalyticsPage(data, page, pageSize, expectedTotal, seen, companyId = '100000') {
  if (!data || data.pageNo !== page || data.pageSize !== pageSize || !Array.isArray(data.rows) || data.rows.length > pageSize || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || typeof data.lastPage !== 'boolean') throw Error('invalid_page')
  if (!data.filter?.includes(`org in (${companyId})`) || !data.filter.includes("org.number = 'hyperzone.test'")) throw Error('unverified_company_scope')
  if (expectedTotal !== undefined && data.totalCount !== expectedTotal) throw Error('changed_total')
  for (const row of data.rows) {
    if (typeof row.id !== 'string' || !/^[1-9]\d*$/.test(row.id) || seen.has(row.id)) throw Error('duplicate_or_invalid_id')
    if (row.org_id != null && row.org_id !== companyId) throw Error('company_mismatch')
    seen.add(row.id)
  }
  if (seen.size > data.totalCount || data.lastPage && seen.size !== data.totalCount || !data.lastPage && (!data.rows.length || seen.size >= data.totalCount)) throw Error('incomplete_page_sequence')
  return data.totalCount
}
export async function captureFamily({ entity, query, directory, context, pageSize = 100 }) {
  if (!Object.hasOwn(operations, entity)) throw Error('invalid_entity')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const manifest = { version: 1, captureId: randomUUID(), entityType: entity, operation: operations[entity], context, companyId: '100000', orgNumber: 'hyperzone.test', capturedAt: new Date().toISOString(), complete: false, coverage: 'full_company_scan', consistentSnapshot: false, pages: [], rowCount: 0 }
  const modificationWindow=modificationWindowOperations.includes(operations[entity])?{startModifytime:'1970-01-01 00:00:00',endModifytime:new Date(Date.parse(manifest.capturedAt)+8*3600000).toISOString().slice(0,19).replace('T',' ')}:{}
  if(modificationWindow.startModifytime)manifest.modificationWindow={from:modificationWindow.startModifytime,toExclusive:modificationWindow.endModifytime,clockBasis:'local_capture_time',sourceTimezone:'+08:00'}
  const seen = new Set(); let total
  try {
    for (let pageNo = 1; pageNo <= 1000; pageNo++) {
      const result = await query({ operation: operations[entity], orgNumber: 'hyperzone.test', ...modificationWindow, pageNo, pageSize, saveResponse: true })
      if (!result.report.success || typeof result.raw !== 'string') {
        manifest.sourceFailure = { httpStatus: result.report.httpStatus ?? null, category: result.report.errorCategory ?? 'invalid-response', pageNo }
        throw Error('source_query_failed')
      }
      const body = JSON.parse(result.raw)
      total = validateAnalyticsPage(body.data, pageNo, pageSize, total, seen)
      const file = `page-${String(pageNo).padStart(4, '0')}.json`
      fs.writeFileSync(path.join(directory, file), result.raw, { mode: 0o600, flag: 'wx' })
      manifest.pages.push({ file, sha256: sha(result.raw), rows: body.data.rows.length })
      manifest.rowCount = seen.size
      if (body.data.lastPage) { manifest.complete = true; break }
      if (pageNo % 50 === 0) console.log(JSON.stringify({ entity, pageNo, rows: seen.size }))
    }
    if (!manifest.complete) throw Error('page_limit')
  } catch (e) { manifest.error = /^[a-z_]+$/.test(e.message) ? e.message : 'capture_failed' }
  manifest.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
  return manifest
}
async function main() {
  const args = process.argv.slice(2)
  if (![3,5].includes(args.length) || args[0] !== '--authorize-one-shot' || args[1] !== '--output' || args.length === 5 && (args[3] !== '--entity' || !Object.hasOwn(operations,args[4]))) throw Error('explicit_one_shot_output_required')
  const env = parseEnv(fs.readFileSync('backend/.env.workbench.local', 'utf8')), cfg = parseEnv(fs.readFileSync('backend/.env.fop.local', 'utf8'))
  if (env.FOP_QUERIES_PAUSED !== 'true' || env.WORKBENCH_SYNC_ENABLED !== 'false' || env.WORKBENCH_AUTOMATIC_CALLS_ENABLED !== 'false') throw Error('persistent_pause_required')
  if (cfg.FOP_KINGDEE_USERNAME !== 'limingsong' || cfg.FOP_KINGDEE_TENANT_ID !== 'hyperzone.test' || cfg.FOP_KINGDEE_ORGANIZATION_IDS !== '100000') throw Error('confirmed_identity_required')
  const output = path.resolve(args[2]); fs.mkdirSync(output, { mode: 0o700 })
  const require = createRequire(import.meta.url)
  require('ts-node').register({ project: path.resolve('backend/tsconfig.json'), transpileOnly: true })
  const { KingdeeFopDataProvider } = require('../backend/src/modules/fop-data/fop-kingdee.provider')
  const config = { ...cfg, FOP_QUERIES_PAUSED: 'false' }
  const provider = new KingdeeFopDataProvider({ get: key => config[key] })
  const connection = await provider.getConnectionContext()
  if (connection.subject.tenantId !== cfg.FOP_KINGDEE_TENANT_ID || connection.subject.userId !== cfg.FOP_KINGDEE_USER_ID || connection.currentOrganization.id !== '100000') throw Error('connection_mismatch')
  config.FOP_OPENAPI_ACCESS_TOKEN = await getToken(config)
  const reports = []
  for (const entity of args.length === 5 ? [args[4]] : Object.keys(operations)) {
    // Purchase lines can be numerous; keep each response below the shared 4 MiB limit.
    const m = await captureFamily({ entity, query: options => runQuery(config, options), directory: path.join(output, entity), context: connection.subject, pageSize: entity === 'purchase' ? 20 : 100 })
    const summary = { entity, complete: m.complete, pages: m.pages.length, rows: m.rowCount, error: m.error ?? null }; reports.push(summary); console.log(JSON.stringify(summary))
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ completedAt: new Date().toISOString(), automaticCallsEnabled: false, reports }, null, 2), { mode: 0o600, flag: 'wx' })
  if (reports.some(r => !r.complete)) process.exitCode = 1
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('analytics_capture_failed; private responses are not logged'); process.exitCode = 1 })
