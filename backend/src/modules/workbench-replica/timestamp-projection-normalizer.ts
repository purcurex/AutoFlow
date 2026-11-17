import { sourceTime } from './timestamp-sync'

type Row = Record<string, any>
export const TIMESTAMP_PROJECTION_KINDS = {
  hzkj_orders: 'fulfillment', hzkj_alloc_bill: 'allocation', hzkj_deliver_bill: 'dispatch', hzkj_deliver_order: 'delivery_notice',
} as const
const ENTRY_KEYS: Record<keyof typeof TIMESTAMP_PROJECTION_KINDS, string> = {
  hzkj_orders: 'hzkj_orders_billentry', hzkj_alloc_bill: 'hzkj_alloc_entry', hzkj_deliver_bill: 'hzkj_logisticstrackentry', hzkj_deliver_order: 'entryentity',
}
const isObject = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key)
function fail(code: string): never { throw Error(`timestamp_projection_${code}`) }
function identifier(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '' || value === '0')) return null
  if (typeof value !== 'string' || !/^[1-9]\d{0,30}$/.test(value)) fail('invalid_id')
  return value as string
}
function clone(value: any): any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('invalid_shape'); return value }
  if (Array.isArray(value)) return value.map(clone)
  if (!isObject(value)) fail('invalid_shape')
  const result: Row = {}
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid_shape')
    if (child !== undefined) result[key] = clone(child)
  }
  return result
}
const BASIC_REF = ['id', 'number', 'name']
const ORDER_REFS: Record<string, string[]> = {
  hzkj_operator: BASIC_REF, hzkj_customer: BASIC_REF, hzkj_payingcustomer: BASIC_REF, hzkj_shop: BASIC_REF,
  hzkj_dept: BASIC_REF, hzkj_dst_warehouse: BASIC_REF, hzkj_country: [...BASIC_REF, 'twocountrycode'],
  hzkj_billtype: BASIC_REF, hzkj_deliveryway: BASIC_REF, hzkj_pricelist: BASIC_REF, hzkj_settletype: BASIC_REF,
  hzkj_settlecurrency: BASIC_REF, hzkj_customer_channel: BASIC_REF, hzkj_eplatform: BASIC_REF, hzkj_admindivision: BASIC_REF,
}
const SKU_PROPS = [...BASIC_REF, 'hzkj_picturefield', 'hzkj_pur_price', 'hzkj_sku_value', 'hzkj_url', 'hzkj_public_title', 'hzkj_public']
const COMMON_TIMES = ['createtime', 'modifytime', 'auditdate']
const HEAD_TIMES: Record<keyof typeof TIMESTAMP_PROJECTION_KINDS, string[]> = {
  hzkj_orders: ['hzkj_bizdate', 'hzkj_syncdate', 'hzkj_datetimefield', 'hzkj_receipt_date'],
  hzkj_alloc_bill: ['modifydatefield', 'hzkj_complete_time', 'hzkj_receipt_date'],
  hzkj_deliver_bill: ['hzkj_actual_freight_time', 'hzkj_push_time', 'hzkj_track_sync_time', 'hzkj_track_next_sync_time', 'hzkj_track_latest_time', 'hzkj_freight_query_time'],
  hzkj_deliver_order: ['hzkj_bizdate', 'hzkj_bill_create_time'],
}

/** Projection-only conversion of the 2026-11-16 native API response; never merge a previous document.
 * The caller must first verify the timestamp response scope. Persist the original document separately.
 */
export function normalizeTimestampProjectionRaw(entityCode: string, input: unknown, companyId: string): Row {
  if (!own(TIMESTAMP_PROJECTION_KINDS, entityCode)) fail('unsupported_entity')
  identifier(companyId)
  if (!isObject(input)) fail('invalid_shape')
  identifier(input.id)
  if (typeof input.billno !== 'string' || !input.billno.trim()) fail('missing_billno')
  const entity = entityCode as keyof typeof TIMESTAMP_PROJECTION_KINDS, entryKey = ENTRY_KEYS[entity]
  if (input[entryKey] !== null && !Array.isArray(input[entryKey])) fail('partial_entries')
  const out = clone(input), mappings: { source: string; target: string }[] = [], unknownTimes: string[] = []
  if (input[entryKey] === null) out[entryKey] = []
  const timeMappings: { field: string; basis: 'explicit_timezone' | 'source_business_timezone_utc8'; precision: 'day' | 'timestamp' }[] = []
  const checkCompany = (value: unknown) => { if (identifier(value) !== companyId) fail('company_mismatch') }
  if (own(input, 'org_id')) checkCompany(input.org_id)
  if (own(input, 'organizationId')) checkCompany(input.organizationId)
  if (input.org !== undefined && input.org !== null) { if (!isObject(input.org)) fail('invalid_shape'); checkCompany(input.org.id) }
  if (input.hzkj_org !== undefined && input.hzkj_org !== null) { if (!isObject(input.hzkj_org)) fail('invalid_shape'); checkCompany(input.hzkj_org.id) }
  if (entity !== 'hzkj_orders' && !own(input, 'org_id')) fail('company_missing')
  const reference = (row: Row, prefix: string, properties: readonly string[], path = '') => {
    const result: Row = {}
    // Nested source objects are current-payload facts only; conflicting flattened IDs are rejected.
    if (row[prefix] !== undefined && row[prefix] !== null) {
      if (!isObject(row[prefix])) fail('invalid_reference')
      if (own(row[prefix], 'id')) identifier(row[prefix].id, true)
    }
    for (const property of properties) {
      const key = `${prefix}_${property}`
      if (!own(row, key)) continue
      const value = property === 'id' ? identifier(row[key], true) : row[key]
      if (property === 'id' && row[prefix]?.id != null && identifier(row[prefix].id, true) !== value) fail('reference_conflict')
      result[property] = value
      mappings.push({ source: `${path}${key}`, target: `${path}${prefix}.${property}` })
    }
    // Do not borrow fields from an older nested shape when flat reference fields are supplied.
    if (Object.keys(result).length) row[prefix] = result
  }
  const time = (row: Row, key: string, path = '') => {
    if (!own(row, key)) return
    const original = row[key], field = `${path}${key}`
    if (original === null || original === '') { row[key] = null; return }
    if (typeof original !== 'string') { row[key] = null; unknownTimes.push(field); return }
    let value = original.replace(' ', 'T')
    const day = key === 'hzkj_bizdate' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    if (day) value += 'T00:00:00'
    const explicit = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    if (!explicit) value += '+08:00'
    try { sourceTime(value) } catch { row[key] = null; unknownTimes.push(field); return }
    row[key] = value
    timeMappings.push({ field, basis: explicit ? 'explicit_timezone' : 'source_business_timezone_utc8', precision: day ? 'day' : 'timestamp' })
  }
  for (const key of [...COMMON_TIMES, ...HEAD_TIMES[entity]]) time(out, key)
  const references = entity === 'hzkj_orders' ? ORDER_REFS : entity === 'hzkj_alloc_bill'
    ? { org: BASIC_REF, hzkj_customer: BASIC_REF, hzkj_warehouse: BASIC_REF, hzkj_operator: BASIC_REF }
    : entity === 'hzkj_deliver_bill'
      ? { org: BASIC_REF, hzkj_customer: BASIC_REF, hzkj_logistics_providers: BASIC_REF, hzkj_shop: BASIC_REF, hzkj_logistics_channel1: BASIC_REF, hzkj_basedatafield: BASIC_REF }
      : { org: BASIC_REF }
  for (const [prefix, properties] of Object.entries(references)) reference(out, prefix, properties)
  if (entity === 'hzkj_orders') {
    out.hzkj_org = { id: companyId, ...(input.hzkj_org?.name != null ? { name: input.hzkj_org.name } : {}) }
    mappings.push({ source: 'verified_timestamp_scope.companyId', target: 'hzkj_org.id' })
  } else out.organizationId = companyId
  if (entity === 'hzkj_alloc_bill' && own(out, 'hzkj_order_id')) identifier(out.hzkj_order_id, true)
  const seen = new Set<string>()
  for (let i = 0; i < out[entryKey].length; i++) {
    const row = out[entryKey][i], path = `${entryKey}[${i}].`
    if (!isObject(row)) fail('invalid_entry')
    const id = identifier(row.id)!
    if (seen.has(id)) fail('duplicate_entry_id')
    seen.add(id)
    if (own(row, 'pid')) identifier(row.pid, true)
    if (entity === 'hzkj_orders') {
      reference(row, 'hzkj_local_sku', SKU_PROPS, path)
      reference(row, 'hzkj_material', BASIC_REF, path)
      reference(row, 'hzkj_warehourse', BASIC_REF, path)
    } else if (entity === 'hzkj_alloc_bill') reference(row, 'hzkj_sku', BASIC_REF, path)
    else if (entity === 'hzkj_deliver_order') { reference(row, 'hzkj_local_sku', BASIC_REF, path); time(row, 'modifydatefield', path) }
    else {
      // Carrier-local process time has a separate timezone field; do not label it as UTC+8.
      time(row, 'hzkj_modifydatefield2', path)
    }
  }
  if (own(out, 'hzkj_logistics_info') && out.hzkj_logistics_info !== null) {
    if (!Array.isArray(out.hzkj_logistics_info)) fail('invalid_packages')
    out.hzkj_logistics_info.forEach((row: unknown, i: number) => {
      if (!isObject(row)) fail('invalid_packages')
      reference(row as Row, 'hzkj_channel', BASIC_REF, `hzkj_logistics_info[${i}].`)
    })
  }
  out.timestampProjection = { version: 1, entityCode, companyId,
    companyBasis: own(input, 'org_id') ? 'source_org_id_checked_against_timestamp_scope' : 'verified_timestamp_scope',
    referenceMappings: mappings, timeMappings, unknownTimes }
  return out
}
