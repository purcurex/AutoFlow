import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const api = await import('./fop-workbench-openapi.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})
const config = { FOP_OPENAPI_IDENTITY: 'fake-private-identity', FOP_OPENAPI_ACCESS_TOKEN: 'fake-private-token' }
const request = { operation: 'order-detail', id: '9223372036854775806' }
const envelope = (rows = [], overrides = {}) => ({ status: true, errorCode: '0', data: { rows, pageNo: 1, pageSize: 10, totalCount: rows.length, lastPage: true, ...overrides } })
const response = value => new Response(JSON.stringify(value))

test('provides a reusable request builder and read-only runner', () => {
  assert.equal(typeof api.buildRequest, 'function')
  assert.equal(typeof api.runQuery, 'function')
})

test('constructs the November 10 company-scoped lists and ID-based details', () => {
  for (const operation of ['order-detail', 'outbound']) {
    assert.deepEqual(api.buildRequest(operation, { id: request.id }).body, { data: { id: request.id }, pageNo: 1, pageSize: 10 })
    assert.throws(() => api.buildRequest(operation, { billno: 'OUT-1' }), /invalid-request/)
  }
  for (const operation of ['order-list', 'allocation', 'dispatch', 'delivery-notice', 'outbound-list', 'purchase-requisition', 'purchase', 'receipt-notice', 'inbound', 'receipt-adjustment', 'receipt', 'payment', 'stock']) {
    assert.deepEqual(api.buildRequest(operation, { orgNumber: 'hyperzone', billno: 'TEST-42', id: '123', pageNo: 2, pageSize: 5 }).body,
      { data: { org_number: 'hyperzone', billno: 'TEST-42', id: '123' }, pageNo: 2, pageSize: 5 })
    assert.throws(() => api.buildRequest(operation), /invalid-request/)
    assert.throws(() => api.buildRequest(operation, { orgNumber: '*' }), /invalid-request/)
  }
  assert.deepEqual(api.buildRequest('stock', { orgNumber: 'hyperzone' }).body.data, { org_number: 'hyperzone' })
  assert.deepEqual(api.parseArgs(['--operation', 'order-list', '--org-number', 'hyperzone']), { operation: 'order-list', orgNumber: 'hyperzone' })
  assert.deepEqual(api.buildRequest('rma', { customerId: '123' }).body.data, { hzkj_payingcustomer_id: '123' })
})

test('rejects audits, prototype properties, unknown inputs and absent or inexact identifiers', () => {
  for (const operation of ['auditFulfillmentOrder', 'allocation-approve', 'allocation-approval-targets', '/kapi/arbitrary', 'constructor', '__proto__']) {
    assert.throws(() => api.buildRequest(operation), /invalid-operation/)
  }
  for (const options of [{}, { id: 123 }, { id: '*' }, { id: '0' }, { id: ' 123' }, { id: '9223372036854775808' }, { id: '123', path: '/other' }]) {
    assert.throws(() => api.buildRequest('order-detail', options), /invalid-request/)
  }
  for (const billno of ['', ' ', '*', 'SO%', 'SO?', 'SO\n1', 'x'.repeat(121)]) {
    assert.throws(() => api.buildRequest('purchase', { orgNumber: 'hyperzone', billno }), /invalid-request/)
  }
  assert.throws(() => api.buildRequest('rma'), /invalid-request/)
  assert.throws(() => api.buildRequest('stock', { customerId: '123' }), /invalid-request/)
})

test('enforces page limits and typed RMA optional whitelist with real calendar dates', () => {
  for (const pageNo of [0, 1001, 1.5, '1', NaN]) assert.throws(() => api.buildRequest('stock', { orgNumber: 'hyperzone', pageNo }), /invalid-request/)
  for (const pageSize of [0, 101, 1.5, '10']) assert.throws(() => api.buildRequest('stock', { orgNumber: 'hyperzone', pageSize }), /invalid-request/)
  const options = { customerId: '123', shopId: '456', salesType: 'B', startDate: '2026-11-01', endDate: '2026-11-09', orderNumber: 'SO-7', reasonId: '789' }
  assert.deepEqual(api.buildRequest('rma', options).body.data, { hzkj_payingcustomer_id: '123', hzkj_shop_id: '456', hzkj_sales_type: 'B', start_date: '2026-11-01', end_date: '2026-11-09', str: 'SO-7', hzkj_resason_id: '789' })
  for (const extra of [{ salesType: 'refund' }, { startDate: '2026-02-30' }, { startDate: '2026-12-01', endDate: '2026-11-01' }, { str: '%' }, { orderNumber: '%' }]) {
    assert.throws(() => api.buildRequest('rma', { ...options, ...extra }), /invalid-request/)
  }
})

test('disables RMA status filtering until the historical schema and deployed states agree', () => {
  for (const orderStatus of ['no', 'partial', 'fulfilled', 'restocked', '0', '1', '3', '6', 'closed']) {
    assert.throws(() => api.buildRequest('rma', { customerId: '123', orderStatus }), /unsupported-rma-status-contract/)
  }
  assert.throws(() => api.parseArgs(['--operation', 'rma', '--customer-id', '123', '--order-status', '1']), /unsupported-rma-status-contract/)
})

test('rejects retired outbound date and array filters rather than silently ignoring them', () => {
  for (const extra of [{ startDate: '2026-11-01' }, { billnos: ['OUT-1'] }, { orgNumbers: ['hyperzone'] }, { startAuditDate: '2026-11-01T00:00:00+08:00' }]) {
    assert.throws(() => api.buildRequest('outbound-list', { orgNumber: 'hyperzone', ...extra }), /invalid-request/)
  }
})

test('queries the confirmed origin with token reuse, safe headers and no redirects', async () => {
  const result = await api.runQuery(config, request, async (url, init) => {
    assert.equal(url, 'https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderDetail')
    assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST')
    assert.equal(init.headers.accessToken, config.FOP_OPENAPI_ACCESS_TOKEN)
    assert.equal(init.headers['x-acgw-identity'], config.FOP_OPENAPI_IDENTITY)
    assert.ok(init.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(init.body), { data: { id: request.id }, pageNo: 1, pageSize: 10 })
    return response(envelope([{ id: request.id }]))
  })
  assert.equal(result.report.success, true); assert.equal(result.report.rowCount, 1)
  assert.equal(result.rows[0].id, request.id); assert.equal(result.raw, null)
  assert.ok(!JSON.stringify(result.report).includes('fake-private'))
})

test('rejects origin and request errors before any credential acquisition', async () => {
  let calls = 0
  const fake = async () => { calls++; return response(envelope()) }
  for (const origin of ['http://hyperzone.test.kdgalaxy.com', 'https://other.example', 'https://hyperzone.test.kdgalaxy.com/evil', 'https://name:password@hyperzone.test.kdgalaxy.com']) {
    await assert.rejects(api.runQuery({ ...config, FOP_OPENAPI_BASE_URL: origin }, request, fake), /invalid-origin/)
  }
  await assert.rejects(api.runQuery(config, { operation: 'allocation-approve' }, fake), /invalid-operation/)
  assert.equal(calls, 0)
})

test('validates business envelopes and paging instead of treating HTTP 200 as success', async () => {
  for (const value of [{ status: false, message: 'fake-private' }, { ...envelope(), errorCode: 'SECRET' }, { ...envelope(), status: 'true' }, { status: true, errorCode: '0', data: {} }, envelope([], { pageNo: 2 }), envelope([], { totalCount: -1 }), envelope([], { pageSize: 0 }), envelope([], { lastPage: 'true' }), envelope([], { rows: {} })]) {
    const result = await api.runQuery(config, request, async () => response(value))
    assert.equal(result.report.success, false)
    assert.ok(!JSON.stringify(result.report).includes('fake-private'))
    assert.ok(!JSON.stringify(result.report).includes('SECRET'))
    assert.deepEqual(result.rows, [])
  }
  const empty = await api.runQuery(config, request, async () => response(envelope()))
  assert.equal(empty.report.success, true); assert.equal(empty.report.rowCount, 0)
})

test('rejects every numeric ID without rounding and can preserve raw query bytes explicitly', async () => {
  const raw = '{"status":true,"errorCode":"0","data":{"rows":[{"id":9223372036854775806}],"pageNo":1,"pageSize":10,"totalCount":1,"lastPage":true}}'
  const result = await api.runQuery(config, { ...request, saveResponse: true }, async () => new Response(raw))
  assert.equal(result.report.success, false); assert.equal(result.report.errorCategory, 'invalid-id')
  assert.deepEqual(result.rows, []); assert.equal(result.raw, raw)
  for (const row of [{ id: 1 }, { id: '1', entries: [{ hzkj_salbillentryid: Number('9223372036854775806') }] }, { billno: 'NO-ID' }]) {
    const invalid = await api.runQuery(config, request, async () => response(envelope([row])))
    assert.equal(invalid.report.errorCategory, 'invalid-id')
  }
})

test('enforces a 4 MiB stream limit even when content-length is missing or false', async () => {
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '4194305' }]) {
    let cancelled = false
    const result = await api.runQuery(config, request, async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) },
      cancel() { cancelled = true },
    }), { headers }))
    assert.equal(result.report.success, false); assert.equal(result.report.errorCategory, 'response-too-large')
    assert.equal(result.raw, null); assert.equal(cancelled, true)
  }
})

test('timeouts include streamed bodies and network errors never expose thrown secrets', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = api.runQuery(config, request, async () => { calls++; return new Response(new ReadableStream({ pull() { return new Promise(() => {}) } })) })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(15_001)
  const result = await pending
  assert.equal(result.report.errorCategory, 'timeout'); assert.equal(calls, 1)
  const failure = await api.runQuery(config, request, async () => { throw new Error('fake-private-token') })
  assert.equal(failure.report.errorCategory, 'network-error'); assert.ok(!JSON.stringify(failure).includes('fake-private'))
})

test('token acquisition uses the same bounded transport and does not leak token error values', async () => {
  const auth = { FOP_OPENAPI_IDENTITY: 'fake-private-identity', FOP_OPENAPI_CLIENT_ID: 'fake-client', FOP_OPENAPI_CLIENT_SECRET: 'fake-private-secret', FOP_OPENAPI_USERNAME: 'fake-user', FOP_OPENAPI_ACCOUNT_ID: 'fake-account' }
  const calls = []
  const result = await api.runQuery(auth, request, async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'error')
    if (url.endsWith('/getToken')) return response({ status: true, errorCode: '0', data: { access_token: 'fake-private-token' } })
    assert.equal(init.headers.accessToken, 'fake-private-token')
    return response(envelope())
  })
  assert.equal(calls.length, 2); assert.equal(result.report.success, true)
  const denied = await api.runQuery(auth, request, async () => response({ status: false, errorCode: 'fake-private-secret' }))
  assert.equal(denied.report.errorCategory, 'authentication-error')
  assert.ok(!JSON.stringify(denied).includes('fake-private'))
})

test('CLI parsing rejects arbitrary switches, duplicated options and noninteger pages', () => {
  assert.deepEqual(api.parseArgs(['--operation', 'order-detail', '--id', '123', '--page-no', '2', '--save-response']), { operation: 'order-detail', id: '123', pageNo: 2, saveResponse: true })
  for (const args of [[], ['--path', '/evil'], ['--operation'], ['--operation', 'stock', '--operation', 'rma'], ['--operation', 'stock', '--page-no', '1.2'], ['--operation', 'stock', '--page-size', '0x10']]) {
    assert.throws(() => api.parseArgs(args), /invalid-arguments|invalid-request/)
  }
})

test('saves original response text to a unique runtime file with owner-only permissions', () => {
  const raw = '{"id":9223372036854775806}'
  const saved = api.saveRawResponse('order-detail', raw)
  try {
    assert.ok(saved.includes('/.runtime/fop-workbench/'))
    assert.equal(statSync(saved).mode & 0o777, 0o600)
    assert.equal(readFileSync(saved, 'utf8'), raw)
    assert.throws(() => api.saveRawResponse('../escape', raw), /invalid-operation/)
  } finally { unlinkSync(saved) }
})

test('redirect, malformed JSON and HTTP errors are sanitized without query retries', async () => {
  for (const [make, category] of [
    [() => new Response('', { status: 302, headers: { Location: 'https://other.example' } }), 'redirect-error'],
    [() => new Response('fake-private-token'), 'invalid-json'],
    [() => new Response('fake-private-token', { status: 503 }), 'http-error'],
  ]) {
    let calls = 0
    const result = await api.runQuery(config, request, async () => { calls++; return make() })
    assert.equal(result.report.errorCategory, category); assert.equal(calls, 1)
    assert.ok(!JSON.stringify(result).includes('fake-private'))
  }
})

test('CLI honors the project pause even with an alternate config and never calls transport', () => {
  const preload = 'globalThis.fetch = async () => { console.error("UNEXPECTED_NETWORK"); throw new Error("must not call") }'
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, fileURLToPath(new URL('./fop-workbench-openapi.mjs', import.meta.url)), '--config', '/nonexistent/fop-fake-test.env', '--operation', 'order-detail', '--id', '123'], { encoding: 'utf8', env: config })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.deepEqual(JSON.parse(result.stderr), { success: false, errorCategory: 'fop_queries_paused' })
})

test('pause blocks workbench queries before token or transport', async () => {
  let calls = 0
  await assert.rejects(api.runQuery({ FOP_QUERIES_PAUSED: 'true' }, { operation: 'order-list', orgNumber: '100' }, async () => { calls++; throw new Error('must not call') }), /fop_queries_paused/)
  assert.equal(calls, 0)
})
