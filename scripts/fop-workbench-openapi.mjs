import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { getToken } from './fop-openapi-smoke.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'https://hyperzone.test.kdgalaxy.com'
const maxBytes = 4 * 1024 * 1024
const routes = Object.freeze({
  'order-list': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderList',
  'order-detail': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderDetail',
  allocation: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_alloc_bill/queryAllocation',
  dispatch: '/kapi/v2/hzkj/hzkj_logistics/hzkj_deliver_bill/queryDispatch',
  'delivery-notice': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_deliver_order/queryDeliveryNotice',
  outbound: '/kapi/v2/hzkj/im/im_saloutbill/queryOutbound',
  'outbound-list': '/kapi/v2/hzkj/im/im_saloutbill/queryOutboundList',
  'purchase-requisition': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purapplybill/queryPurchaseRequisition',
  purchase: '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchase',
  'receipt-notice': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_receiptnotice/queryReceiptNotice',
  inbound: '/kapi/v2/hzkj/im/im_purinbill/queryInbound',
  'receipt-adjustment': '/kapi/v2/hzkj/hzkj_fund/hzkj_adjust_bill/queryReceiptAdjustment',
  receipt: '/kapi/v2/hzkj/hzkj_fund/hzkj_receive_bill/queryReceipt',
  payment: '/kapi/v2/hzkj/hzkj_fund/hzkj_pay_cost_bill/queryPayment',
  rma: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_after_sale_orders/queryAfterSaleOrders',
  stock: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_stock_order_new/queryStockOrder',
})
class QueryError extends Error {
  constructor(category) { super(category); this.category = category }
}
const fail = category => { throw new QueryError(category) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function exact(value) {
  if (typeof value !== 'string' || !value || value.length > 120 || value !== value.trim() || /[\s*%?\\]/u.test(value) || value.includes('[') || value.includes(']') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail('invalid-request')
  return value
}
function id(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) fail('invalid-request')
  return value
}
function oneOf(value, choices) {
  if (!choices.includes(value)) fail('invalid-request')
  return value
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid-request')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail('invalid-request')
  return value
}
function range(options, from, to) {
  if (options[from] !== undefined && options[to] !== undefined && Date.parse(options[from]) > Date.parse(options[to])) fail('invalid-request')
}
function page(value, fallback, max) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1 || value > max) fail('invalid-request')
  return value
}

// Input names are CLI-friendly; only this whitelist can create a request body.
export function buildRequest(operation, options = {}) {
  if (typeof operation !== 'string' || !Object.hasOwn(routes, operation)) fail('invalid-operation')
  if (!object(options)) fail('invalid-request')
  const data = {}
  const allowed = ['pageNo', 'pageSize']
  if (operation === 'order-detail' || operation === 'outbound') {
    allowed.push('id'); data.id = id(options.id)
  } else if (operation === 'rma') {
    allowed.push('customerId', 'shopId', 'salesType', 'startDate', 'endDate', 'orderNumber', 'orderStatus', 'reasonId')
    data.hzkj_payingcustomer_id = id(options.customerId)
    if (options.shopId !== undefined) data.hzkj_shop_id = id(options.shopId)
    if (options.reasonId !== undefined) data.hzkj_resason_id = id(options.reasonId)
    if (options.salesType !== undefined) data.hzkj_sales_type = oneOf(options.salesType, ['A', 'B', 'C', 'D'])
    // The historical Swagger uses shipping labels; current source/runtime use different numeric states.
    // Do not publish either dictionary as a working filter until the deployed contract is reconciled.
    if (options.orderStatus !== undefined) fail('unsupported-rma-status-contract')
    if (options.orderNumber !== undefined) data.str = exact(options.orderNumber)
    if (options.startDate !== undefined) data.start_date = date(options.startDate)
    if (options.endDate !== undefined) data.end_date = date(options.endDate)
    range(options, 'startDate', 'endDate')
  } else {
    allowed.push('orgNumber', 'billno', 'id')
    data.org_number = exact(options.orgNumber)
    if (options.billno !== undefined) data.billno = exact(options.billno)
    if (options.id !== undefined) data.id = id(options.id)
  }
  if (Object.keys(options).some(key => !allowed.includes(key))) fail('invalid-request')
  return { path: routes[operation], body: { data, pageNo: page(options.pageNo, 1, 1000), pageSize: page(options.pageSize, 10, 100) } }
}

function confirmedOrigin(config) {
  let url
  try { url = new URL(config.FOP_OPENAPI_BASE_URL || origin) } catch { fail('invalid-origin') }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('invalid-origin')
  return origin
}

// The deadline covers headers AND stream consumption, including token responses.
async function boundedResponse(fetcher, url, init) {
  const controller = new AbortController()
  let reader, response, timer
  const cancel = () => {
    try { (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}) } catch { /* best effort */ }
  }
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); cancel(); reject(new QueryError('timeout')) }, 15_000)
  })
  const consume = async () => {
    response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal })
    if (response.redirected || (response.status >= 300 && response.status < 400)) fail('redirect-error')
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > maxBytes) fail('response-too-large')
    if (!response.body) return { ok: response.ok, status: response.status, raw: '' }
    reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) fail('response-too-large')
      chunks.push(value)
    }
    return { ok: response.ok, status: response.status, raw: Buffer.concat(chunks, size).toString('utf8') }
  }
  try { return await Promise.race([consume(), deadline]) }
  catch (error) { controller.abort(); cancel(); throw error instanceof QueryError ? error : new QueryError('network-error') }
  finally { clearTimeout(timer) }
}

function validIds(value) {
  if (Array.isArray(value)) return value.every(validIds)
  if (!object(value)) return true
  return Object.entries(value).every(([key, child]) => {
    // Reject even safe numeric IDs: JSON numbers violate this adapter's string-ID contract.
    if (/id$/i.test(key) && child !== null && typeof child !== 'string') return false
    return validIds(child)
  })
}
function validate(json, body) {
  if (!object(json) || json.status !== true || !['0', 0].includes(json.errorCode)) return 'business-error'
  const data = json.data
  if (!object(data) || !Array.isArray(data.rows) || data.pageNo !== body.pageNo || data.pageSize !== body.pageSize || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || typeof data.lastPage !== 'boolean' || data.rows.length > data.pageSize || data.rows.length > data.totalCount) return 'invalid-response'
  if (data.rows.some(row => !object(row) || typeof row.id !== 'string' || !row.id || !validIds(row))) return 'invalid-id'
  return null
}

export async function runQuery(config, options = {}, fetcher = fetch) {
  if (config.FOP_QUERIES_PAUSED?.trim().toLowerCase() === 'true') fail('fop_queries_paused')
  const base = confirmedOrigin(config)
  const { operation, saveResponse = false, ...parameters } = options
  if (typeof saveResponse !== 'boolean') fail('invalid-request')
  const { path, body } = buildRequest(operation, parameters)
  const report = { operation, success: false, httpStatus: null, rowCount: null, errorCategory: null }
  const failure = (category, raw = null) => ({ report: { ...report, errorCategory: category }, rows: [], raw })
  const header = config.FOP_OPENAPI_TOKEN_HEADER || 'accessToken'
  if (!['access_token', 'accessToken', 'accesstoken'].includes(header) || typeof config.FOP_OPENAPI_IDENTITY !== 'string' || !config.FOP_OPENAPI_IDENTITY.trim() || /[\r\n]/.test(config.FOP_OPENAPI_IDENTITY)) return failure('configuration-error')
  let token, tokenTransportError
  try {
    token = await getToken(config, async (url, init) => {
      try {
        const result = await boundedResponse(fetcher, url, init)
        return new Response([204, 205, 304].includes(result.status) ? null : result.raw, { status: result.status })
      } catch (error) { tokenTransportError = error.category; throw error }
    })
  } catch { return failure(tokenTransportError || 'authentication-error') }
  if (config.FOP_QUERIES_PAUSED?.trim().toLowerCase() === 'true') fail('fop_queries_paused')
  let result
  try {
    result = await boundedResponse(fetcher, `${base}${path}`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json', [header]: token,
      'x-acgw-identity': config.FOP_OPENAPI_IDENTITY.trim(),
    }, body: JSON.stringify(body) })
  } catch (error) { return failure(error.category) }
  report.httpStatus = result.status
  const raw = saveResponse ? result.raw : null
  if (!result.ok) return failure('http-error', raw)
  let json
  try { json = JSON.parse(result.raw) } catch { return failure('invalid-json', raw) }
  const category = validate(json, body)
  if (category) return failure(category, raw)
  return { report: { ...report, success: true, rowCount: json.data.rows.length }, rows: json.data.rows, raw }
}

const cliNames = {
  operation: 'operation', config: 'config', id: 'id', billno: 'billno', 'customer-id': 'customerId',
  'page-no': 'pageNo', 'page-size': 'pageSize', 'shop-id': 'shopId', 'sales-type': 'salesType',
  'start-date': 'startDate', 'end-date': 'endDate', 'order-number': 'orderNumber', 'order-status': 'orderStatus',
  'reason-id': 'reasonId', 'org-number': 'orgNumber',
}
export function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--save-response') {
      if (options.saveResponse !== undefined) fail('invalid-arguments')
      options.saveResponse = true; continue
    }
    const name = arg.startsWith('--') ? arg.slice(2) : ''
    if (!Object.hasOwn(cliNames, name)) fail('invalid-arguments')
    const key = cliNames[name], value = args[++index]
    if (Object.hasOwn(options, key) || !value || value.startsWith('--')) fail('invalid-arguments')
    if (['pageNo', 'pageSize'].includes(key)) {
      if (!/^[1-9]\d*$/.test(value)) fail('invalid-arguments')
      options[key] = Number(value)
    } else options[key] = value
  }
  if (!options.operation) fail('invalid-arguments')
  const { operation, config: _configPath, saveResponse: _saveResponse, ...parameters } = options
  buildRequest(operation, parameters)
  return options
}

export function saveRawResponse(operation, raw) {
  if (!Object.hasOwn(routes, operation)) fail('invalid-operation')
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maxBytes) fail('response-save-error')
  const out = join(root, '.runtime/fop-workbench')
  const file = join(out, `${operation}-${Date.now()}-${randomUUID()}-response.json`)
  try {
    mkdirSync(out, { recursive: true, mode: 0o700 })
    // Exclusive creation prevents replacement of prior evidence or following file symlinks.
    writeFileSync(file, raw, { flag: 'wx', mode: 0o600 })
  } catch { fail('response-save-error') }
  return file
}

async function main() {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    console.log('Read-only FOP test queries. --operation <' + Object.keys(routes).join('|') + '>')
    console.log('Order/outbound detail: --id <int64>. RMA: --customer-id <int64>.')
    console.log('All lists: --org-number <company-code> [--billno <exact-number>] [--id <int64>].')
    console.log('Optional: --page-no 1..1000 --page-size 1..100 --config <private-env-file> --save-response')
    return
  }
  const { config: configFile, ...options } = parseArgs(process.argv.slice(2))
  const configPath = resolve(configFile || join(root, 'backend/.env.fop.local'))
  let config
  try { config = { ...(existsSync(configPath) ? parseEnv(readFileSync(configPath, 'utf8')) : {}), ...process.env } }
  catch { fail('configuration-error') }
  const pausePath = join(root, 'backend/.env.fop-pause')
  if (existsSync(pausePath) && parseEnv(readFileSync(pausePath, 'utf8')).FOP_QUERIES_PAUSED === 'true') fail('fop_queries_paused')
  const { report, raw } = await runQuery(config, options)
  if (raw !== null) saveRawResponse(options.operation, raw)
  console.log(JSON.stringify(report))
  if (!report.success) process.exitCode = 2
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ success: false, errorCategory: error instanceof QueryError ? error.category : 'internal-error' }))
  process.exitCode = 1
})
