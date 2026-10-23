import type { EffectiveChartAccess } from './fop-chart-access'
/** Authenticated backend contract. No client-side mock fallback or scope selection. */
export interface FopDashboardQuery { from: string; to: string; year: number }
export interface ReceiptSeries { id: string; name?: string; amounts: number[]; previousAmount?: number | null; breakdown?: { fulfillment: number[]; fullPaymentStock: number[] }; previousBreakdown?: { fulfillment: number; fullPaymentStock: number } }
export interface FopDashboardData {
  chartAccess: EffectiveChartAccess[]
  departmentReceipts: FopDashboardData['receipts']
  source: 'mock' | 'fop'
  updatedAt: string
  queues: { procurement: number; review: number; allocation: number; dispatch: number; shipping: number }
  rates: { currency: string; cnyPerUnit: number }[]
  registrations: { date: string; count: number }[]
  registrationDepartments?: { id: string; name: string; counts: number[]; salespeople: { id: string; name: string; counts: number[] }[] }[]
  exceptions: { id: string; customer: string; reason: 'stock' | 'address' | 'tracking'; hours: number }[]
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

export async function getFopDashboard(query: FopDashboardQuery, now = new Date()): Promise<FopDashboardData> {
  const start = parseDay(query.from)
  const end = parseDay(query.to)
  const day = 86_400_000
  if (start > end || (end - start) / day > 365 || query.to > localDate(now)) throw new Error('Invalid date range')
  if (!Number.isInteger(query.year) || query.year < 2020 || query.year > Number(localDate(now).slice(0, 4))) throw new Error('Invalid year')
  const { default: api } = await import('./index')
  const { from, to, year } = query
  return api.get('/autoflow/integrations/fop/dashboard', { params: { from, to, year } })
}
