import type { ReplicaBarrier, ReplicaChangeGroup, ReplicaChangeSource, ReplicaDatasetScope } from './replica-change-contract'

export const REPLICA_API_VERSION = 'fop-replica/1'
export const REPLICA_API_KEYS = ['SNAPSHOT_BEGIN', 'SNAPSHOT_PAGE', 'BARRIER', 'CHANGES', 'AUTHORIZATION', 'RECONCILE'] as const
export interface ReplicaSnapshot {
  snapshotId: string; scopeVersion: string; sourceAsOf: string; expiresAt: string
  entityCodes: string[]; streams: { key: string; endCursor: string }[]
}
export interface ReplicaSnapshotPage { snapshotId: string; streamKey: string; afterCursor: string | null; complete: boolean; groups: ReplicaChangeGroup[] }
export interface ReplicaAuthorization {
  scopeVersion: string; sourceAsOf: string; expiresAt: string; companyAllowed: boolean
  /** Complete stream barrier covering every ownership mutation; renew only datasets exactly at this vector. */
  ownershipVector: Record<string, string>
  resources: { resource: string; grants: { target: string; decision: 'allow' | 'deny' }[] }[]
  employees: { authUserId: string; personRecordId: string; masterId: string; number: string; enabled: boolean }[]
  references: { resource: string; sourceId: string; masterId?: string; code?: string; name: string; version: string; deleted: boolean }[]
}
export interface ReplicaReconciliation {
  barrierId: string; targetVector: Record<string, string>; scopeVersion: string
  entities: { entityCode: string; count: number; amounts: Record<string, string> }[]
}
export interface ReplicaSourceApi extends ReplicaChangeSource {
  begin(scope: ReplicaDatasetScope, requestKey: string): Promise<ReplicaSnapshot>
  page(scope: ReplicaDatasetScope, snapshot: ReplicaSnapshot, streamKey: string, after: string | null): Promise<ReplicaSnapshotPage>
  authorization(scope: Omit<ReplicaDatasetScope, 'datasetId'>): Promise<ReplicaAuthorization>
  reconcile(scope: ReplicaDatasetScope, barrier: ReplicaBarrier): Promise<ReplicaReconciliation>
}
