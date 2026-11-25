import interfacePolicy from './fop-interface-policy.cjs'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { getToken } from './fop-openapi-smoke.mjs'
import { confirmedFopOrigin } from './fop-confirmed-origin.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'https://hyperzone.test.kdgalaxy.com'
const maxBytes = 4 * 1024 * 1024
const routes = Object.freeze({
  'fulfillment-ids': '/kapi/v2/hzkj/hzkj_ordercenter/fulfillment-orders/ids',
  'bill-relations': '/kapi/v2/hzkj/hzkj_ordercenter/openapi/bill-relations/query',
  'stock-relations': '/kapi/v2/hzkj/hzkj_ordercenter/openapi/bill-relations/stock/query',
  'current-inventory': '/kapi/v2/hzkj/ocbsoc/customer-stock/query',
  'order-list': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderList',
  'order-detail': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_orders/queryOrderDetail',
  allocation: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_alloc_bill/queryAllocation',
  dispatch: '/kapi/v2/hzkj/hzkj_logistics/hzkj_deliver_bill/queryDispatch',
  'delivery-notice': '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_deliver_order/queryDeliveryNotice',
  outbound: '/kapi/v2/hzkj/im/im_saloutbill/queryOutbound',
  'outbound-list': '/kapi/v2/hzkj/im/im_saloutbill/queryOutboundList',
  'purchase-requisition': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purapplybill/queryPurchaseRequisition',
  purchase: '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchase',
  'purchase-material-return': '/kapi/v2/hzkj/im/im_purinbill/queryPurchaseMaterialReturn',
  'purchase-return': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purorderbill/queryPurchaseReturn',
  'receipt-notice': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_receiptnotice/queryReceiptNotice',
  inbound: '/kapi/v2/hzkj/im/im_purinbill/queryInbound',
  'receipt-adjustment': '/kapi/v2/hzkj/hzkj_fund/hzkj_adjust_bill/queryReceiptAdjustment',
  receipt: '/kapi/v2/hzkj/hzkj_fund/hzkj_receive_bill/queryReceipt',
  payment: '/kapi/v2/hzkj/hzkj_fund/hzkj_pay_cost_bill/queryPayment',
  rma: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_after_sale_orders/queryAfterSaleOrders',
  stock: '/kapi/v2/hzkj/hzkj_ordercenter/hzkj_stock_order_new/queryStockOrder',
  'customer-registrations': '/kapi/v2/hzkj/hzkj_member/hzkj_member_customer/queryCustomerRegistrations',
  'purchase-refund-application': '/kapi/v2/hzkj/hzkj_einkauf/hzkj_purrefundapplybill/queryPurchaseRefundApplication',
  'freight-exception': '/kapi/v2/hzkj/hzkj_logistics/hzkj_freight_exception/queryFreightException',
})
export const modificationWindowOperations = Object.freeze(['allocation','dispatch','delivery-notice'])
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
function sourceDateTime(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))fail('invalid-request')
  const utc=value.replace(' ','T')+'Z',parsed=new Date(utc)
  if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,19)!==utc.slice(0,19))fail('invalid-request')
  return value
}
function timeBounds(from,to) {
  const start=sourceDateTime(from),end=sourceDateTime(to)
  if(start>=end)fail('invalid-request')
  return [start,end]
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
  if (['fulfillment-ids','bill-relations','stock-relations','current-inventory'].includes(operation)) {
    const data = {}, allowed = []
    if (operation === 'fulfillment-ids') {
      allowed.push('orgNumber','startModifytime','endModifytime')
      data.orgNumber=exact(options.orgNumber)
      if(options.startModifytime!==undefined||options.endModifytime!==undefined)
        [data.startModifytime,data.endModifytime]=timeBounds(options.startModifytime,options.endModifytime)
    } else if(operation.endsWith('relations')) {
      const key=operation==='bill-relations'?'orderNo':'stockOrderNo'
      allowed.push(key,'level');data[key]=exact(options[key]);data.level=oneOf(options.level??'BILL',['BILL','ENTRY'])
    } else {
      allowed.push('keyword','customerId','warehouseId','standardId','cursor','pageSize')
      for(const key of ['customerId','warehouseId','standardId'])if(options[key]!==undefined)data[key]=id(options[key])
      for(const key of ['keyword','cursor'])if(options[key]!==undefined){
        if(typeof options[key]!=='string'||!options[key].trim()||options[key].length>2000||/[\r\n]/.test(options[key]))fail('invalid-request')
        data[key]=options[key]
      }
      data.pageSize=page(options.pageSize,100,200)
    }
    if(Object.keys(options).some(key=>!allowed.includes(key)))fail('invalid-request')
    return {path:routes[operation],body:operation.endsWith('relations')?data:{query:data}}
  }
  const data = {}
  const allowed = ['pageNo', 'pageSize']
  if(operation==='customer-registrations'){
    allowed.push('orgNumber','orgId','orgName')
    data.org_number=exact(options.orgNumber);data.org_id=id(options.orgId)
    if(typeof options.orgName!=='string'||!options.orgName.trim()||options.orgName.length>200)fail('invalid-request')
    data.org_name=options.orgName
  } else if(operation==='order-list'){
    allowed.push('orgNumber','billno','id','ids','modifytime','createtime')
    data.org_number=exact(options.orgNumber)
    if(options.billno!==undefined)data.billno=exact(options.billno)
    if(options.id!==undefined&&options.ids!==undefined)fail('invalid-request')
    const ids=options.ids??(options.id!==undefined?[options.id]:undefined)
    if(ids!==undefined){if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)fail('invalid-request');data.id=ids.map(id)}
    for(const key of ['modifytime','createtime'])if(options[key]!==undefined)data[key]=sourceDateTime(options[key])
  } else if(operation==='freight-exception'){
    allowed.push('orderNumber');data.hzkj_sale_order_no=exact(options.orderNumber)
  } else if(operation==='purchase-material-return'){
    allowed.push('billno');if(options.billno!==undefined)data.billno=exact(options.billno)
  } else if(operation==='purchase-refund-application'){
    allowed.push('orgNumber');data.org_number=exact(options.orgNumber)
  } else if (operation === 'order-detail' || operation === 'outbound') {
    allowed.push('id'); data.id = id(options.id)
  } else if (operation === 'rma') {
    allowed.push('customerId', 'shopId', 'salesType', 'startDate', 'endDate', 'orderNumber', 'orderStatus', 'reasonId','orgNumber')
    if(options.customerId===undefined&&options.orgNumber===undefined)fail('invalid-request')
    if(options.customerId!==undefined)data.hzkj_payingcustomer_id = id(options.customerId)
    if(options.orgNumber!==undefined)data.org_number=exact(options.orgNumber)
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
  if(modificationWindowOperations.includes(operation)){
    allowed.push('startModifytime','endModifytime')
    if(options.startModifytime===undefined||options.endModifytime===undefined)fail('modification_window_required')
    ;[data.start_modifytime,data.end_modifytime]=timeBounds(options.startModifytime,options.endModifytime)
  }
  const relatedFilters={
    purchase:{sourceStockBillno:'source_stock_billno'},
    'receipt-notice':{purchaseOrderNumber:'hzkj_purchase_order_numbe',purchase1688OrderNumber:'purchase_1688_order_no'},
    payment:{purchaseOrderNumber:'hzkj_purorder_no'},
    inbound:{sourceBillNumber:'srcbillnumber'},'outbound-list':{sourceBillNumber:'srcbillnumber'},'purchase-requisition':{sourceBillNumber:'srcbillnumber'},
    dispatch:{orderNumber:'hzkj_order_no'},'delivery-notice':{dispatchNumber:'hzkj_deliver_billno'},
    allocation:{orderNumber:'hzkj_order_no',packageNumber:'hzkj_pkg_no'},
  }
  for(const [key,field] of Object.entries(relatedFilters[operation]??{})){
    allowed.push(key);if(options[key]!==undefined)data[field]=exact(options[key])
  }
  if (Object.keys(options).some(key => !allowed.includes(key))) fail('invalid-request')
  return { path: routes[operation], body: { data, pageNo: page(options.pageNo, 1, 1000), pageSize: page(options.pageSize, 10, 100) } }
}

function confirmedOrigin(config) {
  try {return confirmedFopOrigin(config)} catch {fail('invalid-origin')}
}

// The deadline covers headers AND stream consumption, including token responses.
export function retryAfterMs(value) {
  if(!value)return null
  const ms=/^\d+$/.test(value)?Number(value)*1000:/^[A-Za-z]{3}, /.test(value)?Date.parse(value)-Date.now():NaN
  return Number.isFinite(ms)&&ms>=0?Math.min(86400000,Math.ceil(ms)):null
}
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
    const retryAfter=retryAfterMs(response.headers.get('retry-after'))
    if (!response.body) return { ok: response.ok, status: response.status, raw: '', retryAfterMs:retryAfter }
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
    return { ok: response.ok, status: response.status, raw: Buffer.concat(chunks, size).toString('utf8'), retryAfterMs:retryAfter }
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
function validate(json, body, operation) {
  if(object(json)&&json.status!==true&&['401','612'].includes(String(json.errorCode)))return 'authentication-error'
  if (!object(json) || json.status !== true || !['0', 0].includes(json.errorCode)) return 'business-error'
  const data = json.data
  if(operation==='fulfillment-ids'){
    if(!object(data)||!Array.isArray(data.ids)||!/^\d+$/.test(String(data.total))||BigInt(data.total)!==BigInt(data.ids.length)||new Set(data.ids).size!==data.ids.length)return 'invalid-response'
    try{data.ids.forEach(id);id(data.organizationId)}catch{return 'invalid-id'}
    if(typeof data.tenantId!=='string'||data.orgNumber!==body.query.orgNumber||data.formId!=='hzkj_orders')return 'invalid-response'
    if(data.ids.some((v,i)=>i>0&&BigInt(v)<=BigInt(data.ids[i-1])))return 'invalid-response'
    return null
  }
  // Relations are retained as source evidence only until their undocumented data schema is verified.
  if(operation.endsWith('relations'))return object(data)?null:'invalid-response'
  if(operation==='current-inventory')return object(data)&&Array.isArray(data.items)&&validIds(data)?null:'invalid-response'
  if (!object(data) || !Array.isArray(data.rows) || data.pageNo !== body.pageNo || data.pageSize !== body.pageSize || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || typeof data.lastPage !== 'boolean' || data.rows.length > data.pageSize || data.rows.length > data.totalCount) return 'invalid-response'
  if (data.rows.some(row => !object(row) || (operation==='purchase-material-return' ? typeof row.billno!=='string'||!row.billno.trim()||(body.data.billno!==undefined&&row.billno!==body.data.billno) : typeof row.id !== 'string' || !row.id) || !validIds(row))) return 'invalid-id'
  return null
}

export async function runQuery(config, options = {}, fetcher = fetch) {
  if (config.FOP_QUERIES_PAUSED?.trim().toLowerCase() === 'true') fail('fop_queries_paused')
  const base = confirmedOrigin(config)
  const { operation, saveResponse = false, ...parameters } = options
  if (typeof saveResponse !== 'boolean') fail('invalid-request')
  const { path, body } = buildRequest(operation, parameters)
  interfacePolicy.assertActiveFopEndpoint(path)
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
  if(result.status===429||result.status===503)report.retryAfterMs=result.retryAfterMs
  const raw = saveResponse ? result.raw : null
  if (!result.ok) {
    let errorCode
    try { errorCode = String(JSON.parse(result.raw)?.errorCode) } catch { /* no untrusted response text in reports */ }
    return failure(result.status===519&&errorCode==='2505'?'api-not-subscribed':result.status===401||result.status===519&&errorCode==='2508'?'authentication-error':'http-error',raw)
  }
  let json
  try { json = JSON.parse(result.raw) } catch { return failure('invalid-json', raw) }
  const category = validate(json, body, operation)
  if (category) return failure(category, raw)
  const rows=json.data.rows??json.data.items??[]
  return { report: { ...report, success: true, rowCount: rows.length }, rows, data:json.data, raw }
}

const cliNames = {
  operation: 'operation', config: 'config', id: 'id', billno: 'billno', 'customer-id': 'customerId',
  'page-no': 'pageNo', 'page-size': 'pageSize', 'shop-id': 'shopId', 'sales-type': 'salesType',
  'start-date': 'startDate', 'end-date': 'endDate', 'order-number': 'orderNumber', 'order-status': 'orderStatus',
  'reason-id': 'reasonId', 'org-number': 'orgNumber', 'org-id':'orgId', 'org-name':'orgName', level:'level', keyword:'keyword', cursor:'cursor', 'warehouse-id':'warehouseId', 'standard-id':'standardId', modifytime:'modifytime', createtime:'createtime',
  from:'from','to-exclusive':'toExclusive','start-modifytime':'startModifytime','end-modifytime':'endModifytime',
  'source-stock-billno':'sourceStockBillno','purchase-order-number':'purchaseOrderNumber','purchase-1688-order-number':'purchase1688OrderNumber',
  'source-bill-number':'sourceBillNumber','dispatch-number':'dispatchNumber','package-number':'packageNumber',
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
