import api from './index'

export interface WorkbenchDataAvailability {
  mode: 'collected'; complete: false; reason?: string; missingFields?: string[]; missingDatasets?: string[]
}
export interface WorkbenchReplicaSnapshot {
  dataMode?: 'collected'
  complete?: boolean
  missingDatasets?: string[]
  readMode: 'local'
  datasetId: string
  revision: string
  sourceSyncedAt: string | null
}
export interface WorkbenchReplicaStatus {
  bootstrap?: {
    allowed: boolean; configured?: boolean; executable?: boolean; blockers?: string[]; missingConfiguration?: string[]
    resume?: { companyId: string; requestKey: string; state: string; errorCode: string | null } | null
  }
  capabilities?: {
    historicalImport: { implemented: boolean; executable: boolean; blockers: string[] }
    incrementalSync: { configured: boolean; executable: boolean; blockers: string[] }
  }
  dataMode?: 'mock' | 'fop' | 'collected'
  mockGeneratedAt?: string | null
  readMode: 'local' | 'live'
  collected?: { batchId: string; sourceAsOf: string | null; rowCount: number; pageCount: number; missingDatasets: string[] }
  state: 'collected' | 'not_initialized' | 'ready' | 'paused' | 'syncing' | 'failed'
  initialized: boolean
  sourceSyncedAt: string | null
  nextScheduledAt: string | null
  datasetId: string | null
  revision: string | null
  syncConfigured?: boolean
  automaticCallsEnabled?: boolean
  navigationMinIntervalSeconds?: number
  paused: boolean
}
export interface WorkbenchReplicaJob {
  id: string | null
  reason?: string
  state: 'blocked' | 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  errorCode?: string
}
const base = '/workbench/replica'
export const getWorkbenchReplicaStatus = (signal?: AbortSignal): Promise<WorkbenchReplicaStatus> => api.get(`${base}/status`, { signal })
export const requestWorkbenchReplicaSync = (requestKey: string, signal: AbortSignal, trigger: 'manual' | 'navigation' = 'manual'): Promise<WorkbenchReplicaJob> => api.post(`${base}/sync`, { requestKey, ...(trigger === 'navigation' ? { trigger } : {}) }, { signal })
export const getWorkbenchReplicaJob = (id: string, signal: AbortSignal): Promise<WorkbenchReplicaJob> => api.get(`${base}/sync/${encodeURIComponent(id)}`, { signal })
export interface WorkbenchBootstrapResult { state: string; datasetId?: string; stage?: string; errorCode?: string | null }
export const configureWorkbenchReplica = (signal: AbortSignal): Promise<{companyId:string}> => api.post(`${base}/bootstrap/configure`, {}, { signal })
export const initializeWorkbenchReplica = (companyId: string, requestKey: string, signal: AbortSignal): Promise<WorkbenchBootstrapResult> => api.post(`${base}/bootstrap`, { companyId, requestKey }, { signal, timeout: 120_000 })
