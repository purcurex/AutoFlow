import { normalizeBusinessTimestamp, validBusinessDay } from './fop-business-time'

type Row = Record<string, unknown>
const sourceId = (v: unknown): string | null => typeof v === 'string' && /^[1-9]\d{0,30}$/.test(v) ? v : null
/** Explicit company-catalogue confirmation supplements native scope, never employee access. */
export function verifiedCustomerRegistrationScope(proof: Row | undefined, context: { companyId: string; tenantId: string }): boolean {
  if (!proof || proof.companyId !== context.companyId) return false
  if (proof.basis === 'native_response_createorg_conjunction') return true
  return proof.basis === 'user_confirmed_company_catalogue' && context.companyId === '100000'
    && context.tenantId === 'hyperzone.test' && proof.tenantId === context.tenantId
    && proof.sourceEntity === 'hzkj_member_customer' && proof.confirmedOn === '2026-11-16'
}
/** Advertise only complete UTC+8 business dates inside the verified capture. */
export function customerRegistrationWindow(capture: Row | undefined, context: { companyId: string; tenantId: string }) {
  if (!capture || capture.companyId !== context.companyId || capture.coverage !== 'company_creation_window'
    || !verifiedCustomerRegistrationScope(capture.scopeProof as Row | undefined, context)) return undefined
  const identity = capture.connectionProof as Row | undefined
  if (identity?.basis !== 'authenticated_connection_context' || identity.tenantId !== context.tenantId
    || identity.companyId !== context.companyId || !identity.userId) return undefined
  const start = Date.parse(String(capture.start)), end = Date.parse(String(capture.end)), asOf = String(capture.capturedAt)
  if (![start, end, Date.parse(asOf)].every(Number.isFinite)) return undefined
  const day = 86_400_000, offset = 8 * 3_600_000
  const first = Math.ceil((start + offset) / day) * day
  const last = (Math.floor((end + offset) / day) - 1) * day
  if (first > last) return undefined
  return { from: new Date(first).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10), asOf }
}
/** FOP emits unzoned business timestamps in UTC+8. Date-only/invalid values stay unknown. */
export function customerCreatedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !validBusinessDay(value.slice(0, 10))) return null
  const iso = value.replace(' ', 'T')
  return normalizeBusinessTimestamp(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(iso) ? `${iso}+08:00` : iso)
}
export function normalizeCustomerRegistration(raw: Row, context: { companyId: string; capturedAt: string }) {
  const id = sourceId(raw.id), companyId = sourceId(raw.createorg_id)
  if (!id || !companyId || companyId !== context.companyId) throw new Error('customer_registration_source_scope_mismatch')
  if (!normalizeBusinessTimestamp(context.capturedAt)) throw new Error('customer_registration_capture_time_invalid')
  return { source_id: id, company_id: companyId, source_entity: 'hzkj_member_customer',
    source_owner_user_id: sourceId(raw.hzkj_biz_user_id), created_at: customerCreatedAt(raw.createtime),
    raw, captured_at: context.capturedAt }
}
