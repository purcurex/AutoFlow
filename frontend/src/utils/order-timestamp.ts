/** Parse an explicit ISO instant; never infer a zone or normalize an invalid calendar date. */
export function orderTimestamp(value: unknown): number | null {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null
  const timestamp = Date.parse(value), calendarDay = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(timestamp) && Number.isFinite(calendarDay) && new Date(calendarDay).toISOString().slice(0, 10) === value.slice(0, 10) ? timestamp : null
}
