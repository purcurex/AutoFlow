import Decimal from 'decimal.js'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { completedSalesRows } from './fop-kingdee.sales-completed'
import { matchesBusinessScope, type BusinessScope } from '../users/business-scope'
import { FopIntegrationUnavailableError, FopPermissionDeniedError, type FopIdentity, type FopPermissionGrant, type FopOrder } from './fop-data.types'
import type { RmaCaseCandidate, RmaSnapshot } from './rma-orders'
type Row = Record<string, unknown>
export type RmaSource = { id: string; number: string; customer: string; payer: string; shop: string; owner: string; organization: string }
export interface RmaDiscoveryCache { key?: string; expiresAt?: number; sources?: RmaSource[]; pending?: Promise<RmaSource[]> }
const object = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid RMA response'); return v as Row }
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const id = (v: unknown) => { const s = text(v); if (!/^[1-9]\d{0,18}$/.test(s)) throw new Error('Invalid RMA reference'); return s }
const count = (v: unknown) => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v; if (!Number.isSafeInteger(n) || Number(n) < 0) throw new Error('Invalid RMA pagination'); return Number(n) }
const amount = (v: unknown) => { if (v == null) return null; if (!['string','number'].includes(typeof v)) throw new Error('Invalid RMA amount'); const n = new Decimal(String(v)); if (!n.isFinite() || n.lt(0) || n.gt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid RMA amount'); return n.toNumber() }
const timestamp = (v: unknown) => normalizeBusinessTimestamp(typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? `${v.replace(' ', 'T')}+08:00` : v)
const stages: Record<string, string> = { '0': '取消', '1': '待处理', '2': '处理中', '3': '处理完成', '4': '已补发', '5': '取消发货', '6': '已关闭' }
const types = { A: 'return_refund', B: 'refund', C: 'reshipment' } as const
/** Concurrency is bounded per request. A failed worker stops scheduling further requests. */
async function each<T>(values: readonly T[], work: (v: T) => Promise<void>) {
  let next = 0, failure: unknown
  await Promise.all(Array.from({ length: Math.min(6, values.length) }, async () => {
    while (next < values.length && !failure) { const v = values[next++]; try { await work(v) } catch (e) { failure = e } }
  }))
  if (failure) throw failure
}
export async function readKingdeeRma(options: {
  flowStatus?: 'active' | 'closed' | 'all'; identity: Readonly<FopIdentity>; permission: Readonly<FopPermissionGrant>; scope: Readonly<BusinessScope>
  organizations: Record<string, string>; warehouses: Record<string, 'HZ' | 'SZ'>
  call: (key: string, body: unknown, deadline: number) => Promise<unknown>
  discoveryCache?: RmaDiscoveryCache; workbenchQuery: Row; verifyPage: (raw: Row) => void
}): Promise<{ snapshot: RmaSnapshot; orders: FopOrder[]; permission: FopPermissionGrant }> {
  const { identity, permission, scope, call } = options, deadline = Date.now() + 150_000
  const byNumber = new Map<string, RmaSource>(), seenSources = new Set<string>(), cases: RmaCaseCandidate[] = [], orders = new Map<string, FopOrder>()
  let bytes = 0
  const bounded = (v: unknown) => { bytes += Buffer.byteLength(JSON.stringify(v)); if (bytes > 512 * 1024 * 1024) throw new FopIntegrationUnavailableError('fop_result_too_large') }
  // Native list is discovery only. A source becomes authorized only after its exact
  // employee-orders lookup below; cached/listed source IDs can never grant access.
  const cache = options.discoveryCache, cacheKey = JSON.stringify([identity, scope, permission.orderQuery, options.organizations])
  const discover = async () => {
    for (const [organization, number] of Object.entries(options.organizations)) {
      let total = -1
      const read = async (pageNo: number) => {
        const page = object(await call('FOP_KINGDEE_RMA_ORDER_LIST_URL', { data: { org_number: number }, pageNo, pageSize: 200 }, deadline)); bounded(page)
        const size = count(page.totalCount)
        if (size > 100000 || total !== -1 && size !== total || page.pageNo !== pageNo || page.pageSize !== 200 || typeof page.lastPage !== 'boolean' || !Array.isArray(page.rows)
          || page.rows.length !== Math.min(200, Math.max(0, size - (pageNo - 1) * 200)) || page.lastPage !== (pageNo * 200 >= size)) throw new Error('RMA source discovery changed or incomplete')
        total = size
        for (const value of page.rows) {
          const row = object(value), key = id(row.id), owner = text(row.hzkj_operator_id)
          if (seenSources.has(key)) throw new Error('Duplicate RMA source discovery')
          seenSources.add(key)
          // Safe narrowing only; the employee endpoint is the final order authority.
          if (scope.localOrganization?.employeeIds && !scope.localOrganization.employeeIds.includes(owner) || scope.role === 'salesperson' && owner !== scope.employeeId) continue
          const source: RmaSource = { id: key, number: text(row.billno), customer: id(row.hzkj_customer_id), payer: id(row.hzkj_payingcustomer_id), shop: text(row.hzkj_shop_id), owner, organization }
          if (!source.number || byNumber.has(source.number)) throw new Error('Ambiguous RMA source number')
          byNumber.set(source.number, source)
        }
      }
      await read(1)
      await each(Array.from({ length: Math.max(0, Math.ceil(total / 200) - 1) }, (_, i) => i + 2), read)
    }
    return [...byNumber.values()]
  }
  if (cache?.key !== cacheKey) { if (cache) { cache.key = cacheKey; cache.expiresAt = 0; cache.sources = undefined; cache.pending = undefined } }
  let sources: RmaSource[]
  if (cache?.sources && (cache.expiresAt ?? 0) > Date.now()) sources = cache.sources
  else {
    const pending = cache?.pending ?? discover()
    if (cache) cache.pending = pending
    try { sources = await pending; if (cache?.key === cacheKey) { cache.sources = sources; cache.expiresAt = Date.now() + 60_000 } }
    finally { if (cache?.pending === pending) cache.pending = undefined }
  }
  byNumber.clear()
  for (const source of sources) byNumber.set(source.number, source)
  const byCustomer = new Map<string, RmaSource[]>()
  for (const source of byNumber.values()) { const group = byCustomer.get(source.payer) ?? []; group.push(source); byCustomer.set(source.payer, group) }
  const seenCases = new Set<string>(), nativeCases: { row: Row; source: RmaSource }[] = []
  await each([...byCustomer.keys()], async customer => {
    let total = -1, collected = 0
    for (let pageNo = 1; pageNo <= 1000; pageNo++) {
      const page = object(await call('FOP_KINGDEE_RMA_URL', { data: { hzkj_payingcustomer_id: customer }, pageNo, pageSize: 100 }, deadline)); bounded(page)
      const size = count(page.totalCount)
      if (page.pageNo !== pageNo || page.pageSize !== 100 || total !== -1 && size !== total || size > 100000 || typeof page.lastPage !== 'boolean' || !Array.isArray(page.rows)
        || page.rows.length !== Math.min(100, Math.max(0, size - (pageNo - 1) * 100)) || page.lastPage !== (pageNo * 100 >= size)) throw new Error('RMA cases changed or incomplete')
      total = size; collected += page.rows.length
      for (const value of page.rows) {
        const row = object(value), key = id(row.id)
        if (seenCases.has(key)) throw new Error('Duplicate native RMA case')
        seenCases.add(key)
        if (seenCases.size > 100000) throw new FopIntegrationUnavailableError('fop_result_too_large')
        const source = byNumber.get(text(row.hzkj_srcnumber))
        if (source && source.payer === customer && source.shop === text(row.hzkj_shop_id)) nativeCases.push({ row, source })
      }
      if (page.lastPage) break
    }
    if (collected !== total) throw new Error('Incomplete RMA case pagination')
  })
  // Seek immediately before the exact 64-bit ID. This avoids a full raw-facts scan,
  // while keeping the employee endpoint's own company, role and employee filters.
  const relevant = nativeCases.filter(({ row }) => {
    const state = text(row.hzkj_orderstatus)
    if (!Object.prototype.hasOwnProperty.call(types, text(row.hzkj_sales_type)) || state !== '' && !Object.prototype.hasOwnProperty.call(stages, state)) throw new Error('Unknown native RMA type or status')
    if (!options.flowStatus || options.flowStatus === 'all') return true
    return options.flowStatus === 'active' ? state === '1' || state === '2' : ['0','3','4','5','6'].includes(state)
  })
  await each([...new Map(relevant.map(c => [c.source.id, c.source])).values()], async source => {
    const raw = object(await call('FOP_KINGDEE_QUERY_URL', { query: { ...options.workbenchQuery, queue: 'review', rawWorkbenchFacts: true, page: 1, pageSize: 1,
      afterOrderId: (BigInt(source.id) - 1n).toString() } }, deadline)); bounded(raw)
    options.verifyPage(raw)
    if (raw.workbenchFactsSchemaVersion !== 1 || raw.queue !== 'review' || raw.page !== 1 || raw.pageSize !== 1 || !Array.isArray(raw.items) || raw.items.length > 1
      || !Array.isArray(raw.organizationIds) || raw.organizationIds.some(org => !permission.orderQuery!.organizationIds.includes(String(org))) || typeof raw.hasMore !== 'boolean') throw new Error('Invalid RMA source authority')
    if (!raw.items.length) return
    const row = object(raw.items[0])
    if (row.id !== source.id) return // Exact source is no longer visible under current employee permission.
    const org = object(row.hzkj_org), owner = row.hzkj_operator == null ? undefined : object(row.hzkj_operator)
    if (org.id !== source.organization || !raw.organizationIds.includes(org.id) || row.billno !== source.number || object(row.hzkj_customer).id !== source.customer
      || text(owner?.id) !== source.owner || text(row.hzkj_shop == null ? '' : object(row.hzkj_shop).id) !== source.shop
      || !matchesBusinessScope(scope, { owner: owner ? { id: text(owner.id) } : undefined, department: row.hzkj_dept == null ? undefined : { id: text(object(row.hzkj_dept).id) }, departmentPathIds: row.departmentPathIds as string[] })) throw new FopPermissionDeniedError('RMA source ownership changed')
    const normalized = completedSalesRows([row], { queue: 'review', page: 1, pageSize: 1 }, options.warehouses, true)
    if (normalized.length !== 1) throw new Error('Unsupported RMA fulfillment source')
    // hzkj_order_amount binds to hzkj_settlecurrency, not the base hzkj_currency.
    const settlement = row.hzkj_settlecurrency == null ? '' : text(object(row.hzkj_settlecurrency).number)
    normalized[0].currency = /^[A-Z]{3}$/.test(settlement) ? settlement : 'XXX'
    orders.set(source.id, normalized[0])
  })
  for (const { row, source } of nativeCases) {
    const order = orders.get(source.id)
    if (!order) continue
    const state = text(row.hzkj_orderstatus), type = types[text(row.hzkj_sales_type) as keyof typeof types]
    if (!type || state !== '' && !Object.prototype.hasOwnProperty.call(stages, state)) throw new Error(`Unknown native RMA type or status: ${text(row.hzkj_sales_type).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20)}/${state.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20)}`)
    cases.push({ id: id(row.id), tenantId: identity.tenantId, orderId: source.id, number: text(row.number) || null, type,
      isOpen: state === '' ? null : state === '1' || state === '2', stage: stages[state] ?? '状态未提供', reason: text(row.hzkj_resason1) || text(row.hzkj_resason_name) || null,
      createdAt: timestamp(row.createtime), updatedAt: timestamp(row.modifytime), requestedAmount: null, currency: null,
      refundAmount: type === 'reshipment' ? null : amount(row.hzkj_refund_amount), refundCurrency: type !== 'reshipment' && /^[A-Z]{3}$/.test(text(row.hzkj_tocurr_number)) ? text(row.hzkj_tocurr_number) : null })
  }
  cases.sort((a,b) => a.id.localeCompare(b.id))
  return { snapshot: { subject: { ...identity }, cases }, orders: [...orders.values()], permission: { ...permission, allowedOrderIds: [...orders.keys()], allowedRmaCaseIds: cases.map(c => c.id) } }
}
