import { beforeEach, expect, it } from 'vitest'
import {clearDashboardSnapshots,peekDashboardSnapshot,saveDashboardSnapshot} from '@/utils/dashboard-snapshot'
import {invalidateSession} from '@/utils/session'
import type {FopDashboardData} from '@/api/fop-dashboard'
const query={from:'2026-01-01',to:'2026-11-18',year:2026}
beforeEach(clearDashboardSnapshots)
it('isolates query ranges and returns a detached snapshot',()=>{
 saveDashboardSnapshot(query,{updatedAt:'original'} as FopDashboardData)
 const copy=peekDashboardSnapshot(query)!;copy.updatedAt='modified'
 expect(peekDashboardSnapshot(query)?.updatedAt).toBe('original')
 expect(peekDashboardSnapshot({...query,year:2025})).toBeUndefined()
})
it('clears snapshots when the login session changes',()=>{
 saveDashboardSnapshot(query,{updatedAt:'original'} as FopDashboardData)
 invalidateSession();expect(peekDashboardSnapshot(query)).toBeUndefined()
})
