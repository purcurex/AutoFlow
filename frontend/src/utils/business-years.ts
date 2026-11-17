/** Business reporting begins in 2026; a new year becomes selectable in UTC+8. */
export const FIRST_BUSINESS_YEAR = 2026
export const BUSINESS_START_DATE = `${FIRST_BUSINESS_YEAR}-01-01`
export function businessYears(currentYear = Number(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 4))): number[] {
  return Array.from({ length: Math.max(0, currentYear - FIRST_BUSINESS_YEAR + 1) }, (_, index) => currentYear - index)
}
