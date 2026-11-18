/** Confirmed business default: refund amounts use USD when no currency is supplied. */
export function rmaRefundCurrency(value: unknown): string | null {
  if (value == null || typeof value === 'string' && !value.trim()) return 'USD'
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z]{3}$/.test(currency) ? currency : null
}
