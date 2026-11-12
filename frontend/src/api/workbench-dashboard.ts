import { getFopOrders, type FopOrderQueue } from './fop-orders'
import { getWorkbenchAccess } from './workbench-access'
import type { DashboardQueue, DashboardQueueState, FopDashboardData } from './fop-dashboard'
import { getWorkbenchCount } from '@/utils/workbench-counts'
import { roleForQueue } from '@/utils/workbench'
import { assertCurrentSession, captureSession, StaleSessionError } from '@/utils/session'

const groups = {
  review: ['review'], dispatch: ['dispatch'], procurement: ['procurement', 'procurement_shipping'],
  allocation: ['allocation', 'allocation_review'], shipping: ['shipping'],
} as const
export function isWorkbenchScopeError(cause: unknown): boolean {
  const error = cause as { code?: string; statusCode?: number }
  return cause instanceof StaleSessionError || error?.statusCode === 401 || error?.statusCode === 403
    || ['fop_binding_required', 'fop_binding_changed', 'fop_permission_denied', 'business_access_disabled', 'business_scope_required', 'local_organization_scope_required', 'chart_access_denied'].includes(error?.code ?? '')
}
export type DashboardPending = Pick<FopDashboardData, 'queues' | 'queueStates' | 'queueBreakdown' | 'integratedQueues' | 'tasks'>
export async function getWorkbenchDashboardCounts(): Promise<DashboardPending> {
  const session = captureSession()
  const access = await getWorkbenchAccess()
  assertCurrentSession(session)
  const queues = {} as FopDashboardData['queues']
  const queueStates: DashboardPending['queueStates'] = {}
  const queueBreakdown: DashboardPending['queueBreakdown'] = {}
  await Promise.all((Object.keys(groups) as DashboardQueue[]).map(async key => {
    const entries = await Promise.all(groups[key].map(async (queue: FopOrderQueue) => {
      let state: DashboardQueueState = 'ready', count: number | null = null
      if (!access.roles.includes(roleForQueue(queue))) state = 'forbidden'
      else {
        try {
          count = await getWorkbenchCount(queue, async () => {
            const result = await getFopOrders({ queue, page: 1, pageSize: 1, projection: 'count' })
            if (result.dataAvailability?.missingDatasets?.length) throw { code: 'fop_feature_not_configured' }
            return result.total
          })
        } catch (cause) {
          const error = cause as { code?: string; statusCode?: number }
          // A revoked scope must discard the entire snapshot, not combine old authorized totals.
          if (isWorkbenchScopeError(cause)) throw cause
          state = error.code === 'fop_feature_not_configured' ? 'not_configured' : 'unavailable'
        }
      }
      return { queue, count, state }
    }))
    queueBreakdown[key] = entries
    let state = entries.find(entry => entry.state === 'unavailable')?.state ?? entries.find(entry => entry.state !== 'ready')?.state ?? 'ready'
    const total = entries.reduce((sum, entry) => sum + (entry.count ?? 0), 0)
    if (!Number.isSafeInteger(total)) state = 'unavailable'
    queues[key] = state === 'ready' ? total : null
    queueStates[key] = state
  }))
  assertCurrentSession(session)
  const integratedQueues = (Object.keys(groups) as DashboardQueue[]).filter(key => queueStates[key] === 'ready')
  return { queues, queueStates, queueBreakdown, integratedQueues,
    tasks: integratedQueues.filter(key => queues[key]! > 0).map(key => ({ id: key, kind: key, count: queues[key]!, time: '', priority: key === 'allocation' ? 'normal' : 'high' })) }
}
