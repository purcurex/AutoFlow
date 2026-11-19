/** ISO date ordering shared by CRM demo lists; sorting precedes pagination. */
export function sortCrmDates<T extends { id: string; createdAt: string }>(rows: T[], date: (row: T) => string | null | undefined, direction: 'asc' | 'desc' = 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const left = date(a), right = date(b)
    if (!left && right) return 1
    if (left && !right) return -1
    const order = left && right ? left.localeCompare(right) : 0
    return (direction === 'asc' ? order : -order) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  })
}
