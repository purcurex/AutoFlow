#!/usr/bin/env node
// One-shot read-only capture. No scheduling or persistent configuration changes.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runQuery } from './fop-workbench-openapi.mjs'
import { getToken } from './fop-openapi-smoke.mjs'
export const sha = raw => createHash('sha256').update(raw).digest('hex')
export function registrationWindow(from, toExclusive) {
  const valid = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) && Number.isFinite(Date.parse(v.replace(' ', 'T') + '+08:00')) && new Date(Date.parse(v.replace(' ', 'T') + '+08:00') + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') === v
  if (!valid(from) || !valid(toExclusive) || from >= toExclusive) throw Error('invalid_creation_window')
  return { start: new Date(from.replace(' ', 'T') + '+08:00').toISOString(), end: new Date(toExclusive.replace(' ', 'T') + '+08:00').toISOString() }
}
/** Only parse simple AND predicates emitted by native query APIs; unknown syntax fails closed. */
export function registrationScopeProof(filter, companyId = '100000', context = {}) {
  const fail = () => { throw Error('source_scope_unverified') }
  if (typeof filter !== 'string' || filter.length > 16000) fail()
  const tokens = []; let rest = filter.trim()
  // The native API renders its conjunction inside square brackets.
  if (rest.startsWith('[') && rest.endsWith(']')) rest = rest.slice(1,-1)
  while (rest.trim()) {
    const match = /^\s*('[^']*(?:''[^']*)*'|[A-Za-z_][A-Za-z0-9_.]*|[0-9]+|>=|<=|<>|=|>|<|\(|\)|,)/.exec(rest)
    if (!match) fail()
    tokens.push(match[1]); rest = rest.slice(match[0].length)
  }
  let i = 0, proven = false
  const peek = token => tokens[i]?.toLowerCase() === token
  const literal = () => { const token = tokens[i++]; if (!token || !/^(?:[0-9]+|'[^']*(?:''[^']*)*')$/.test(token)) fail(); return token.startsWith("'") ? token.slice(1,-1).replaceAll("''", "'") : token }
  const expression = () => {
    const term = () => {
      if (peek('(')) { i++; expression(); if (!peek(')')) fail(); i++; return }
      const field = tokens[i++]?.toLowerCase(); if (!['createorg','createorg.id','createtime'].includes(field)) fail()
      const op = tokens[i++]?.toLowerCase(); let values
      if (op === 'in') {
        if (!peek('(')) fail(); i++; values = [literal()]
        while (peek(',')) { i++; values.push(literal()) }
        if (!peek(')')) fail(); i++
      } else { if (!['=','>=','<=','>','<','<>'].includes(op)) fail(); values = [literal()] }
      if (field === 'createorg' || field === 'createorg.id') {
        if (!['=','in'].includes(op) || values.length !== 1 || values[0] !== companyId) fail()
        proven = true
      }
    }
    term(); while (peek('and')) { i++; term() }
  }
  expression()
  if (i !== tokens.length) fail()
  // User confirmed the entire customer catalogue belongs to Huazhi on 2026-11-16.
  // This is an explicit source-scope fact, not a fabricated API filter/authorization.
  if (!proven && companyId === '100000' && context.tenantId === 'hyperzone.test') return {
    companyId, basis: 'user_confirmed_company_catalogue', tenantId: 'hyperzone.test',
    sourceEntity: 'hzkj_member_customer', confirmedOn: '2026-11-16',
  }
  if (!proven) fail()
  return { companyId, basis: 'native_response_createorg_conjunction' }
}
export function registrationConnectionProof(connection, expected) {
  if (connection?.subject?.tenantId !== expected.tenantId || connection?.subject?.userId !== expected.userId || connection?.currentOrganization?.id !== '100000') throw Error('connection_mismatch')
  return { tenantId: connection.subject.tenantId, userId: connection.subject.userId, companyId: connection.currentOrganization.id, basis: 'authenticated_connection_context' }
}
export function validateRegistrationPage(envelope, pageNo, pageSize, previousTotal, seen, companyId = '100000') {
  const d = envelope?.data
  if (envelope?.status !== true || String(envelope.errorCode) !== '0' || !d || d.pageNo !== pageNo || d.pageSize !== pageSize || !Array.isArray(d.rows) || d.rows.length > pageSize || !Number.isSafeInteger(d.totalCount) || d.totalCount < 0 || typeof d.lastPage !== 'boolean') throw Error('invalid_page')
  if (previousTotal !== undefined && d.totalCount !== previousTotal) throw Error('unstable_total')
  let last = seen.size ? [...seen].at(-1) : undefined
  for (const row of d.rows) {
    if (typeof row.id !== 'string' || !/^[1-9]\d{0,30}$/.test(row.id) || seen.has(row.id) || last && BigInt(row.id) <= BigInt(last)) throw Error('invalid_id_order')
    if (typeof row.createorg_id !== 'string' || !/^[1-9]\d{0,30}$/.test(row.createorg_id)) throw Error('missing_company')
    if (row.createorg_id !== companyId) throw Error('source_scope_mismatch')
    seen.add(row.id); last = row.id
  }
  if (seen.size > d.totalCount || d.lastPage && seen.size !== d.totalCount || !d.lastPage && (!d.rows.length || seen.size >= d.totalCount)) throw Error('incomplete_pages')
  return d.totalCount
}
export async function captureRegistrations({ query, directory, context, connection, from, toExclusive, pageSize = 100 }) {
  registrationWindow(from, toExclusive)
  const connectionProof = registrationConnectionProof(connection, context)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const m = { version: 1, captureId: randomUUID(), entityType: 'registrations', operation: 'customer-registrations', sourceEntity: 'hzkj_member_customer', context, connectionProof, scopeProof: null, companyId: '100000', capturedAt: new Date().toISOString(), from, toExclusive, complete: false, coverage: 'company_creation_window', consistentSnapshot: false, pages: [], sourceRowCount: 0, rowCount: 0 }
  const seen = new Set(); let total
  try {
    for (let pageNo = 1; pageNo <= 1000; pageNo++) {
      const result = await query({ operation: 'customer-registrations', from, toExclusive, pageNo, pageSize, saveResponse: true })
      if (!result.report.success || typeof result.raw !== 'string') {
        m.sourceFailure = { httpStatus: result.report.httpStatus ?? null, category: result.report.errorCategory ?? 'invalid-response', pageNo }
        throw Error('source_query_failed')
      }
      const envelope = JSON.parse(result.raw)
      m.scopeProof = registrationScopeProof(envelope?.data?.filter,m.companyId,context)
      total = validateRegistrationPage(envelope, pageNo, pageSize, total, seen)
      const file = `page-${String(pageNo).padStart(4,'0')}.json`
      fs.writeFileSync(path.join(directory,file),result.raw,{ mode: 0o600, flag: 'wx' })
      m.pages.push({ file, sha256: sha(result.raw), rows: envelope.data.rows.length })
      m.sourceRowCount = seen.size; m.rowCount += envelope.data.rows.filter(r => r.createorg_id === m.companyId).length
      if (envelope.data.lastPage) { m.complete = true; break }
    }
    if (!m.complete) throw Error('page_limit')
  } catch (e) { m.error = /^[a-z_]+$/.test(e.message) ? e.message : 'capture_failed' }
  m.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(m,null,2),{ mode: 0o600, flag: 'wx' })
  return m
}
async function main() {
  const a = process.argv.slice(2)
  if (a.length !== 7 || a[0] !== '--authorize-one-shot' || a[1] !== '--from' || a[3] !== '--to-exclusive' || a[5] !== '--output') throw Error('explicit_one_shot_window_output_required')
  registrationWindow(a[2],a[4])
  const env = parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')), cfg = parseEnv(fs.readFileSync('backend/.env.fop.local','utf8'))
  if (env.FOP_QUERIES_PAUSED !== 'true' || env.WORKBENCH_SYNC_ENABLED !== 'false' || env.WORKBENCH_AUTOMATIC_CALLS_ENABLED !== 'false') throw Error('persistent_pause_required')
  if (cfg.FOP_KINGDEE_USERNAME !== 'limingsong' || cfg.FOP_KINGDEE_TENANT_ID !== 'hyperzone.test' || cfg.FOP_KINGDEE_ORGANIZATION_IDS !== '100000' || !cfg.FOP_KINGDEE_USER_ID) throw Error('confirmed_identity_required')
  const config = { ...cfg, FOP_QUERIES_PAUSED: 'false' }
  const require = createRequire(import.meta.url)
  require('ts-node').register({ project: path.resolve('backend/tsconfig.json'), transpileOnly: true })
  const { KingdeeFopDataProvider } = require('../backend/src/modules/fop-data/fop-kingdee.provider')
  const provider = new KingdeeFopDataProvider({ get: key => config[key] })
  const connection = await provider.getConnectionContext()
  registrationConnectionProof(connection, { tenantId: cfg.FOP_KINGDEE_TENANT_ID, userId: cfg.FOP_KINGDEE_USER_ID })
  config.FOP_OPENAPI_ACCESS_TOKEN = await getToken(config)
  const m = await captureRegistrations({ query: opts => runQuery(config,opts), directory: path.resolve(a[6]), connection, context: { tenantId: cfg.FOP_KINGDEE_TENANT_ID, userId: cfg.FOP_KINGDEE_USER_ID }, from: a[2], toExclusive: a[4] })
  console.log(JSON.stringify({ complete: m.complete, rows: m.rowCount, pages: m.pages.length, error: m.error ?? null, sourceFailure: m.sourceFailure ?? null, automaticCallsEnabled: false }))
  if (!m.complete) process.exitCode = 1
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('customer_registration_capture_failed; private source data not logged'); process.exitCode = 1 })
