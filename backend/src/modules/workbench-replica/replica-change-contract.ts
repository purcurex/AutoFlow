export type ReplicaRow = { table: string; values: Record<string, unknown> }
export interface ReplicaDatasetScope { connectionId: string; companyId: string; datasetId: string }
export interface ReplicaChange {
  eventId: string; entityCode: string; sourceId: string; sourceVersion: string
  operation: 'upsert' | 'delete'; localDocumentId: string; documentNumber: string
  linesComplete: true; rows: ReplicaRow[]; affectedOrderIds: string[]
  sourceFields?: { rawBillStatus?: string | null; createdAt?: string | null; modifiedAt?: string | null; auditedAt?: string | null; relationRevision?: string }
}
export interface ReplicaProjection { orderDocumentId: string; deleted: boolean; rows: ReplicaRow[] }
export interface ReplicaReceiptNoticeProjection { documentId: string; deleted: boolean; rows: ReplicaRow[] }
export interface ReplicaChangeGroup {
  groupKey: string; afterCursor: string | null; endCursor: string; committedAt: string
  expectedCount: number; events: ReplicaChange[]; projections: ReplicaProjection[]
  receiptNotices?: ReplicaReceiptNoticeProjection[]
}
export interface ReplicaBarrier {
  id: string; scopeVersion: string; sourceAsOf: string; expiresAt: string
  targetVector: Record<string, string>; proof: Record<string, unknown>
}
export const REPLICA_CHANGE_SOURCE = Symbol('REPLICA_CHANGE_SOURCE')

/** The source adapter must use service identity and a reliable commit feed, never a user-filtered order page. */
export interface ReplicaChangeSource {
  isConfigured(): boolean
  barrier(scope: ReplicaDatasetScope): Promise<ReplicaBarrier>
  groups(scope: ReplicaDatasetScope, streamKey: string, after: string | null, until: string): Promise<ReplicaChangeGroup[]>
}

export class UnconfiguredReplicaChangeSource implements ReplicaChangeSource {
  isConfigured() { return false }
  async barrier(_scope: ReplicaDatasetScope): Promise<ReplicaBarrier> { throw new Error('workbench_replica_sync_not_configured') }
  async groups(_scope: ReplicaDatasetScope, _streamKey: string, _after: string | null, _until: string): Promise<ReplicaChangeGroup[]> { throw new Error('workbench_replica_sync_not_configured') }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const version = /^\d{1,30}$/
const validText = (value: unknown, max = 160): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max

/** Validate before SQL; JavaScript numbers never carry source versions or opaque source IDs. */
export function validateChangeGroup(group: ReplicaChangeGroup): ReplicaChangeGroup {
  if (!Number.isInteger(group.expectedCount) || group.expectedCount < 1 || group.expectedCount > 1000 || group.events.length !== group.expectedCount) throw new Error('Invalid commit manifest')
  if (!validText(group.groupKey) || !validText(group.endCursor, 2000) || group.afterCursor !== null && !validText(group.afterCursor, 2000) || group.afterCursor === group.endCursor) throw new Error('Invalid source cursor')
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(group.committedAt) || !Number.isFinite(Date.parse(group.committedAt))) throw new Error('Invalid source commit time')
  const events = new Set<string>(), documents = new Set<string>(), projections = new Set<string>()
  for (const event of group.events) {
    if (!validText(event.eventId, 128) || !validText(event.entityCode, 128) || !validText(event.sourceId, 128) || !uuid.test(event.localDocumentId)) throw new Error('Invalid source identity')
    if (typeof event.sourceVersion !== 'string' || !version.test(event.sourceVersion)) throw new Error('Invalid source version')
    if (events.has(event.eventId) || documents.has(`${event.entityCode}:${event.sourceId}`)) throw new Error('Invalid duplicate commit member')
    if (!['upsert', 'delete'].includes(event.operation) || event.linesComplete !== true || !Array.isArray(event.rows) || event.affectedOrderIds.some(id => !uuid.test(id))) throw new Error('Incomplete source snapshot')
    if (event.sourceFields) {
      if (Object.keys(event.sourceFields).some(key => !['rawBillStatus','createdAt','modifiedAt','auditedAt','relationRevision'].includes(key))) throw new Error('Unapproved source field')
      for (const key of ['createdAt','modifiedAt','auditedAt'] as const) {
        const timestamp = event.sourceFields[key]
        if (timestamp != null && (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))) throw new Error('Invalid source field time')
      }
      if (event.sourceFields.rawBillStatus != null && !validText(event.sourceFields.rawBillStatus,64) || event.sourceFields.relationRevision !== undefined && !/^\d{1,18}$/.test(event.sourceFields.relationRevision)) throw new Error('Invalid source metadata')
    }
    events.add(event.eventId); documents.add(`${event.entityCode}:${event.sourceId}`)
  }
  for (const item of group.projections) {
    if (!uuid.test(item.orderDocumentId) || projections.has(item.orderDocumentId) || !Array.isArray(item.rows)) throw new Error('Invalid duplicate projection')
    projections.add(item.orderDocumentId)
  }
  const notices = new Set<string>()
  for (const item of group.receiptNotices ?? []) {
    if (!uuid.test(item.documentId) || notices.has(item.documentId) || !Array.isArray(item.rows) || typeof item.deleted !== 'boolean') throw new Error('Invalid duplicate receipt notice projection')
    notices.add(item.documentId)
  }
  for (const event of group.events) for (const id of event.affectedOrderIds) if (!projections.has(id)) throw new Error('Missing affected order projection')
  return group
}
