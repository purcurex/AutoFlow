import { ServiceUnavailableException } from '@nestjs/common'
import { FULFILLMENT_QUEUE_ROLES } from '../users/dto/workbench.dto'
import type { WorkbenchRole } from '../users/workbench-role'
import type { Queue } from './workbench-queue-rules'

export const DASHBOARD_QUEUES = {
  review: ['review'],
  dispatch: ['dispatch'],
  procurement: ['procurement', 'procurement_shipping'],
  allocation: ['allocation', 'allocation_review'],
  shipping: ['shipping'],
} as const satisfies Record<string, readonly Queue[]>
export type DashboardQueue = keyof typeof DASHBOARD_QUEUES
export type DashboardQueueState = 'ready' | 'forbidden' | 'not_configured' | 'unavailable'
type QueueCount = { queue: Queue; count: number | null; state: DashboardQueueState }

export function dashboardQueueFailure(error: unknown): DashboardQueueState {
  // Authorization errors must invalidate the response, never become a partial success.
  if (!(error instanceof ServiceUnavailableException)) throw error
  const response = error.getResponse()
  return typeof response === 'object' && 'code' in response && response.code === 'fop_feature_not_configured'
    ? 'not_configured' : 'unavailable'
}

/** Both pairs are disjoint by matchesQueue: procurement complete vs incomplete, stock ready vs incomplete. */
export async function dashboardQueues(roles: readonly WorkbenchRole[], count: (queue: Queue) => Promise<number | null>) {
  const queues = {} as Record<DashboardQueue, number | null>
  const queueStates = {} as Record<DashboardQueue, DashboardQueueState>
  const queueBreakdown = {} as Record<DashboardQueue, QueueCount[]>
  for (const key of Object.keys(DASHBOARD_QUEUES) as DashboardQueue[]) {
    const entries: QueueCount[] = []
    for (const queue of DASHBOARD_QUEUES[key]) {
      if (!roles.includes(FULFILLMENT_QUEUE_ROLES[queue])) {
        entries.push({ queue, count: null, state: 'forbidden' }); continue
      }
      try {
        const value = await count(queue)
        if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ServiceUnavailableException('Invalid queue count')
        entries.push({ queue, count: value, state: value === null ? 'not_configured' : 'ready' })
      } catch (error) {
        entries.push({ queue, count: null, state: dashboardQueueFailure(error) })
      }
    }
    queueBreakdown[key] = entries
    queueStates[key] = entries.find(entry => entry.state === 'unavailable')?.state
      ?? entries.find(entry => entry.state !== 'ready')?.state ?? 'ready'
    const total = entries.reduce((sum, entry) => sum + (entry.count ?? 0), 0)
    if (!Number.isSafeInteger(total)) queueStates[key] = 'unavailable'
    queues[key] = queueStates[key] === 'ready' ? total : null
  }
  const integratedQueues = (Object.keys(queues) as DashboardQueue[]).filter(queue => queueStates[queue] === 'ready')
  const tasks = integratedQueues.filter(queue => queues[queue]! > 0).map(queue => ({
    id: queue, kind: queue, count: queues[queue]!, time: '', priority: queue === 'allocation' ? 'normal' as const : 'high' as const,
  }))
  return { queues, queueStates, queueBreakdown, integratedQueues, tasks }
}
