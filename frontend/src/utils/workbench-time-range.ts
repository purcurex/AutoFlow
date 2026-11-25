type Period = '1w' | '1m' | '3m'
export function workbenchTimeRange(value: unknown): Period
export function workbenchTimeRange(value: unknown, allowAll: true): Period | 'all'
export function workbenchTimeRange(value: unknown, allowAll = false): Period | 'all' {
  if (allowAll && value === 'all') return 'all'
  return value === '1w' || value === '1m' || value === '3m' ? value : '3m'
}
