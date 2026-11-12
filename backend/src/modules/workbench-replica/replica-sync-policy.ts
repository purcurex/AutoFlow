/** Current runtime policy; historical schema snapshots remain immutable. */
export const REPLICA_NAVIGATION_MIN_INTERVAL_SECONDS = 60
export const REPLICA_BUSINESS_INTERVAL_MINUTES = 30
export type ReplicaSyncTrigger = 'manual' | 'navigation' | 'scheduled'
export const replicaScopeLock = (scope: { connectionId: string; companyId: string; datasetId: string }) =>
  `replica-company:${scope.connectionId}:${scope.companyId}:${scope.datasetId}`
