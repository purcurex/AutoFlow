import type { FopDashboardData, FopDashboardQuery } from '@/api/fop-dashboard'
import { onSessionReset } from './session'
const snapshots = new Map<string, string>()
const key = (query: FopDashboardQuery) => JSON.stringify([query.from, query.to, query.year])
export function clearDashboardSnapshots() { snapshots.clear() }
onSessionReset(clearDashboardSnapshots)
export function peekDashboardSnapshot(query: FopDashboardQuery): FopDashboardData | undefined {
 const value = snapshots.get(key(query)); return value ? JSON.parse(value) : undefined
}
export function saveDashboardSnapshot(query: FopDashboardQuery, value: FopDashboardData) {
 const id=key(query);snapshots.delete(id);snapshots.set(id,JSON.stringify(value))
 while(snapshots.size>4)snapshots.delete(snapshots.keys().next().value!)
}
