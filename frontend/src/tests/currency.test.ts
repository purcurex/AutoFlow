import { describe, expect, it } from 'vitest'
import { currencyCode, formatCurrency, formatUsdExchangeRate } from '@/utils/currency'
describe('default business currency', () => {
  it('defaults missing or empty currency to USD', () => {
    for (const value of [undefined, null, '', '  ']) expect(currencyCode(value)).toBe('USD')
    expect(formatCurrency(12.5)).toBe('$12.50')
  })
  it('preserves explicit currencies rather than relabeling amounts', () => {
    expect(currencyCode('cny')).toBe('CNY')
    expect(formatCurrency(12.5, 'EUR')).toContain('€')
  })
  it('inverts the unrounded source rate for a four-decimal USD-base quote', () => {
    expect(formatUsdExchangeRate(0.1404494382022472, 'CNY')).toBe('USD/CNY 7.1200')
    expect(formatUsdExchangeRate(1.25, 'EUR')).toBe('USD/EUR 0.8000')
    expect(formatUsdExchangeRate(1, 'USD')).toBe('USD/USD 1.0000')
  })
  it('does not display an invalid rate as a valid exchange quote', () => {
    for (const rate of [0, -1, NaN, Infinity, Number.MIN_VALUE]) expect(formatUsdExchangeRate(rate, 'CNY')).toBe('—')
    expect(formatUsdExchangeRate(1, '')).toBe('—')
  })
})
