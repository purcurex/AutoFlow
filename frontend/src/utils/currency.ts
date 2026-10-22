/** Unspecified monetary values default to USD; explicit source currencies are preserved. */
export const DEFAULT_CURRENCY = 'USD'
export function currencyCode(value?: string | null): string {
  const code = value?.trim().toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY
}
export function formatCurrency(amount: number, currency?: string | null, locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode(currency), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

/** Dashboard charts use USD with the compact dollar symbol in every locale. */
export function formatChartCurrency(amount: number, locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: DEFAULT_CURRENCY, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}
