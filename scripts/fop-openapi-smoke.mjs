import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const OPERATIONS = {
  order: ['POST', '/kapi/v2/hzkj/hzkj_ordercenter/order/queryOrder'],
  dispatch: ['POST', '/kapi/v2/hzkj/hzkj_logistics/hzkj_deliver_bill/queryDispatch'],
  allocation: ['POST', '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_alloc_bill/queryAllocation'],
  purchase: ['POST', '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchase'],
  departments: ['POST', '/kapi/v2/base/bos_adminorg/getList'],
  'user-by-username': ['POST', '/kapi/v2/xkbase/bos_user/getListByUserName'],
  'user-by-name': ['POST', '/kapi/v2/kdxk/base/bos_user/getUserListByName'],
  'user-by-id': ['GET', '/kapi/v2/base/bos_user/getList'],
}
const required = (config, key) => {
  const value = config[key]?.trim()
  if (!value) throw new Error(`Missing configuration: ${key}`)
  return value
}
function baseUrl(config) {
  const url = new URL(config.FOP_OPENAPI_BASE_URL || 'https://hyperzone.test.kdgalaxy.com')
  if (url.origin !== 'https://hyperzone.test.kdgalaxy.com' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('This smoke tool only supports the confirmed HTTPS FOP test origin')
  }
  return url.origin
}
function safeCode(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32) : null }
function successful(json) { return json?.status === true && (json.errorCode == null || String(json.errorCode) === '0' || json.errorCode === '') }

async function request(fetcher, url, init) {
  let response
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }) }
  catch { throw new Error('FOP network/TLS/timeout/redirect error; credentials and response bodies are not logged') }
  const raw = await response.text()
  let json
  try { json = JSON.parse(raw) } catch { json = null }
  return { response, json, raw }
}

export async function getToken(config, fetcher = fetch) {
  const base = baseUrl(config)
  required(config, 'FOP_OPENAPI_IDENTITY')
  if (config.FOP_OPENAPI_ACCESS_TOKEN?.trim()) return config.FOP_OPENAPI_ACCESS_TOKEN.trim()
  const body = {
    client_id: required(config, 'FOP_OPENAPI_CLIENT_ID'),
    client_secret: required(config, 'FOP_OPENAPI_CLIENT_SECRET'),
    username: required(config, 'FOP_OPENAPI_USERNAME'),
    accountId: required(config, 'FOP_OPENAPI_ACCOUNT_ID'),
    language: 'zh_CN', nonce: randomUUID(), timestamp: new Date().toISOString(),
  }
  const { response, json } = await request(fetcher, `${base}/kapi/oauth2/getToken`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-acgw-identity': config.FOP_OPENAPI_IDENTITY }, body: JSON.stringify(body),
  })
  if (!response.ok || !successful(json) || typeof json.data?.access_token !== 'string' || !json.data.access_token) {
    throw new Error(`Token acquisition failed: HTTP ${response.status}, code ${safeCode(json?.errorCode) ?? 'unknown'}`)
  }
  // One token per CLI invocation, reused for its query; never returned in reports or written to disk.
  return json.data.access_token
}

export function queryBody(config, operation) {
  if (operation === 'order') return {
    customerId: required(config, 'FOP_TEST_CUSTOMER_ID'), type: required(config, 'FOP_TEST_ORDER_TYPE'),
    str: required(config, 'FOP_TEST_ORDER_NUMBER'), pageIndex: 0, pageSize: 10,
  }
  if (['dispatch', 'allocation', 'purchase'].includes(operation)) return {
    data: { billno: required(config, `FOP_TEST_${operation.toUpperCase()}_NUMBER`) }, pageNo: 1, pageSize: 10,
  }
  throw new Error('Organization/user query schemas were not supplied; pass a confirmed --request JSON file')
}

export async function runAuthCheck(config, fetcher = fetch) {
  if (config.FOP_OPENAPI_ACCESS_TOKEN?.trim()) throw new Error('Auth-only requires client credentials; a supplied token must be verified by a business query')
  await getToken(config, fetcher)
  return { report: { checkedAt: new Date().toISOString(), origin: baseUrl(config), operation: 'token', mode: 'token-authentication', success: true }, raw: null }
}

export async function runCheck(config, { probe = false, operation = 'order', body } = {}, fetcher = fetch) {
  const base = baseUrl(config)
  const target = OPERATIONS[operation]
  if (!target) throw new Error('Unknown read-only operation')
  if (probe && operation !== 'order') throw new Error('Unauthenticated probe only targets the documented order route')
  body = probe ? { str: config.FOP_TEST_ORDER_NUMBER || 'SO261028000002', pageIndex: 0, pageSize: 1 } : body ?? queryBody(config, operation)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be a JSON object')
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (!probe) {
    const header = config.FOP_OPENAPI_TOKEN_HEADER || 'access_token'
    if (!['access_token', 'accessToken', 'accesstoken'].includes(header)) throw new Error('Unsupported token header')
    headers[header] = await getToken(config, fetcher)
    headers['x-acgw-identity'] = required(config, 'FOP_OPENAPI_IDENTITY')
  }
  const url = new URL(`${base}${target[1]}`)
  const init = { method: target[0], headers }
  if (target[0] === 'GET') {
    for (const [key, value] of Object.entries(body)) {
      if (/token|secret|identity|password/i.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('GET query accepts scalar business parameters only')
      url.searchParams.set(key, String(value))
    }
  } else init.body = JSON.stringify(body)
  const { response, json, raw } = await request(fetcher, url.href, init)
  const success = response.ok && successful(json)
  const rows = Array.isArray(json?.data?.rows) ? json.data.rows : Array.isArray(json?.data?.array) ? json.data.array : Array.isArray(json?.data?.list) ? json.data.list : null
  // A successful envelope is distinct from finding the requested order.
  const matchedOrder = operation === 'order' && !probe && rows
    ? rows.some(row => row?.billno === body.str) : null
  return { report: {
    checkedAt: new Date().toISOString(), origin: base, operation, path: target[1], mode: probe ? 'unauthenticated-probe' : 'authenticated-query',
    httpStatus: response.status, errorCode: safeCode(json?.errorCode), success,
    rowCount: rows?.length ?? null, matchedOrder,
    dataKeys: json?.data && typeof json.data === 'object' && !Array.isArray(json.data) ? Object.keys(json.data).slice(0, 30) : [],
  }, raw: probe || !success ? null : raw }
}

async function main() {
  const args = process.argv.slice(2)
  const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
  const configPath = resolve(value('--config') || join(root, 'backend/.env.fop.local'))
  const operation = args.includes('--auth-only') ? 'token' : value('--operation') || 'order'
  const requestFile = value('--request')
  let config, body
  try {
    config = { ...(existsSync(configPath) ? parseEnv(readFileSync(configPath, 'utf8')) : {}), ...process.env }
    body = requestFile ? JSON.parse(readFileSync(resolve(requestFile), 'utf8')) : undefined
  } catch { throw new Error('Unable to read configuration or request JSON; file contents are not logged') }
  const { report, raw } = args.includes('--auth-only') ? await runAuthCheck(config) : await runCheck(config, { probe: args.includes('--probe'), operation, body })
  const out = join(root, '.runtime/fop-test')
  mkdirSync(out, { recursive: true, mode: 0o700 })
  // Exclusive files prevent clobbering prior evidence or following existing symlinks.
  const suffix = `${Date.now()}-${randomUUID()}`
  writeFileSync(join(out, `${operation}-${suffix}-report.json`), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  if (raw && args.includes('--save-response')) {
    // Keep original JSON text: FOP 64-bit numeric IDs must not be rounded by JSON.parse/stringify.
    writeFileSync(join(out, `${operation}-${suffix}-response.json`), raw, { flag: 'wx', mode: 0o600 })
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.success || report.mode === 'unauthenticated-probe') process.exitCode = 2
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1
})
