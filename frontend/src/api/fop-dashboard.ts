import { getWorkbenchDashboardCounts, isWorkbenchScopeError } from './workbench-dashboard'
import { assertCurrentSession, captureSession } from '@/utils/session'
import type { FopExceptionType } from './fop-orders'
import type { FopOrderQueue } from './fop-orders'
import type { EffectiveChartAccess } from './fop-chart-access'
/** Authenticated backend contract. No client-side mock fallback or scope selection. */
export interface FopDashboardQuery { from: string; to: string; year: number }
export interface ReceiptSeries { id: string; name?: string; amounts: number[]; previousAmount?: number | null; breakdown?: { fulfillment: number[]; fullPaymentStock: number[] }; previousBreakdown?: { fulfillment: number; fullPaymentStock: number } }
export type DashboardQueue = 'review' | 'dispatch' | 'procurement' | 'allocation' | 'shipping'
export type DashboardQueueState = 'ready' | 'forbidden' | 'not_configured' | 'unavailable'
export interface FopDashboardData {
  chartAccess: EffectiveChartAccess[]
  departmentReceipts: FopDashboardData['receipts']
  source: 'mock' | 'fop'
  updatedAt: string
  queues: { procurement: number | null; review: number | null; allocation: number | null; dispatch: number | null; shipping: number | null }
  queueStates?: Partial<Record<DashboardQueue, DashboardQueueState>>
  queueBreakdown?: Partial<Record<DashboardQueue, { queue: FopOrderQueue; count: number | null; state: DashboardQueueState }[]>>
  integratedQueues?: string[]
  analyticsConfigured?: boolean
  analyticsUnavailable?: boolean
  rates: { currency: string; cnyPerUnit: number }[]
  registrations: { date: string; count: number }[]
  registrationDepartments?: { id: string; name: string; counts: number[]; salespeople: { id: string; name: string; counts: number[] }[] }[]
  exceptions: { id: string; customer: string; type: FopExceptionType | null; reason: string | null; hours: number }[]
  tasks: { id: string; kind: 'review' | 'dispatch' | 'procurement' | 'allocation' | 'shipping'; count: number; time: string; priority: 'high' | 'normal' }[]
  receipts: { timeZone?: 'UTC+8'; basis?: 'actual_received'; currency: 'USD'; months: string[]; previousMonth?: string; marketingCenter?: ReceiptSeries | null; departments: (ReceiptSeries & { salespeople: (ReceiptSeries & { name: string })[] })[] }
}

export function localDate(date: Date): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

function parseDay(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid date')
  }
  return timestamp
}

export async function getFopDashboard(query: FopDashboardQuery, now = new Date(), onPending?: (pending: import('./workbench-dashboard').DashboardPending) => void): Promise<FopDashboardData> {
  const start = parseDay(query.from)
  const end = parseDay(query.to)
  const day = 86_400_000
  if (start > end || (end - start) / day > 365 || query.to > localDate(now)) throw new Error('Invalid date range')
  if (!Number.isInteger(query.year) || query.year < 2020 || query.year > Number(localDate(now).slice(0, 4))) throw new Error('Invalid year')
  const { default: api } = await import('./index')
  const { from, to, year } = query
  // 真实统计包含权限核对及多页事实汇总，使用独立超时，不改变其他业务接口。
  const session = captureSession()
  let active = true
  try {
    const [analytics, pending] = await Promise.all([
      api.get<FopDashboardData, FopDashboardData>('/autoflow/integrations/fop/dashboard', { params: { from, to, year, includeQueues: false }, timeout: 180000 }).catch((cause: unknown) => {
        if (isWorkbenchScopeError(cause)) throw cause
        // Pending lists remain useful when an independent chart source is unavailable.
        return { source: 'fop', updatedAt: new Date().toISOString(), analyticsUnavailable: true,
          chartAccess: [], rates: [], registrations: [], exceptions: [],
          receipts: { currency: 'USD', months: [], departments: [] },
          departmentReceipts: { currency: 'USD', months: [], departments: [] } } as Omit<FopDashboardData, keyof import('./workbench-dashboard').DashboardPending>
      }),
      getWorkbenchDashboardCounts().then(pending => {
        assertCurrentSession(session)
        if (active) onPending?.(pending)
        return pending
      }),
    ])
    assertCurrentSession(session)
    return { ...analytics, ...pending }
  } finally { active = false }
}
