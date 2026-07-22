export function normalizeDomain(value: string): string | null {
  const candidate = value.includes('://') ? value : `https://${value}`

  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null
  } catch {
    return null
  }
}

export function trafficScore(monthlyVisits?: number): number {
  if (!monthlyVisits || monthlyVisits <= 0) return 0
  if (monthlyVisits >= 100000) return 100
  if (monthlyVisits >= 50000) return 85
  if (monthlyVisits >= 20000) return 70
  if (monthlyVisits >= 5000) return 50
  return 30
}
