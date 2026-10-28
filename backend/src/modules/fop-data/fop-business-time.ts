export const BUSINESS_TIME_ZONE = 'UTC+8' as const
export const DAY_MS = 86_400_000
/** Only complete ISO instants with an explicit zone and valid calendar date. */
export function normalizeBusinessTimestamp(value: unknown): string | null {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !businessDate(value)) return null
  return new Date(value).toISOString()
}
export function businessDate(value: string | Date): string {
  if (typeof value === 'string' && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validBusinessDay(value.slice(0, 10)))) return ''
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? new Date(at + 8 * 3_600_000).toISOString().slice(0, 10) : ''
}
export function validBusinessDay(value: string): boolean {
  const at = Date.parse(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value
}
