import { describe, expect, it } from 'vitest'
import { currencyCode, formatCurrency } from '@/utils/currency'
describe('default business currency', () => {
  it('defaults missing or empty currency to USD', () => {
    for (const value of [undefined, null, '', '  ']) expect(currencyCode(value)).toBe('USD')
    expect(formatCurrency(12.5)).toBe('$12.50')
  })
  it('preserves explicit currencies rather than relabeling amounts', () => {
    expect(currencyCode('cny')).toBe('CNY')
    expect(formatCurrency(12.5, 'EUR')).toContain('€')
  })
})
