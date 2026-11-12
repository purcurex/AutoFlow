import type { FopOrderQuery, FopOrderQueue } from '@/api/fop-orders'
import { assertCurrentSession, captureSession, onSessionReset } from './session'

const totals = new Map<FopOrderQueue, { total: number; at: number }>()
const pending = new Map<FopOrderQueue, Promise<number>>()
const revisions = new Map<FopOrderQueue, number>()
let generation = 0
const TTL = 60_000
export function clearWorkbenchCounts() { generation++; totals.clear(); pending.clear(); revisions.clear() }
onSessionReset(clearWorkbenchCounts)
function unfiltered(query: FopOrderQuery) {
  // Whitelist count-neutral fields so future filters cannot silently contaminate totals.
  return Object.entries(query).every(([key, value]) => value === undefined || value === ''
    || ['projection', 'queue', 'page', 'pageSize', 'paidAtOrder', 'sortBy', 'sortOrder'].includes(key)
    || key === 'completed' && value === false)
}
function valid(total: number) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid workbench total')
  return total
}
export function rememberWorkbenchCount(query: FopOrderQuery, total: number, session: number) {
  assertCurrentSession(session)
  if (unfiltered(query)) totals.set(query.queue, { total: valid(total), at: Date.now() })
}
/** The latest started unfiltered list query wins, including refresh failures. */
export function beginWorkbenchCount(query: FopOrderQuery) {
  if (!unfiltered(query)) return undefined
  const session = captureSession(), epoch = generation, revision = (revisions.get(query.queue) ?? 0) + 1
  revisions.set(query.queue, revision)
  totals.delete(query.queue)
  return (total?: number) => {
    assertCurrentSession(session)
    if (epoch !== generation || revisions.get(query.queue) !== revision) return
    if (total !== undefined) rememberWorkbenchCount(query, total, session)
  }
}
export async function getWorkbenchCount(queue: FopOrderQueue, load: () => Promise<number>): Promise<number> {
  const cached = totals.get(queue)
  if (cached && Date.now() - cached.at < TTL) return cached.total
  const existing = pending.get(queue)
  if (existing) return existing
  const session = captureSession(), epoch = generation, revision = revisions.get(queue)
  const request = Promise.resolve().then(load).then(total => {
    assertCurrentSession(session)
    if (epoch !== generation) throw new Error('Workbench counts changed; reload')
    const value = valid(total)
    if (revisions.get(queue) !== revision) {
      const latest = totals.get(queue)
      if (!latest) throw new Error('Workbench count superseded; reload')
      return latest.total
    }
    totals.set(queue, { total: value, at: Date.now() })
    return value
  }).finally(() => { if (pending.get(queue) === request) pending.delete(queue) })
  pending.set(queue, request)
  return request
}
