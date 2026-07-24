import { describe, expect, it } from 'vitest'
import {
  QUOTE_COUNTRIES,
  createDefaultProductTiers,
  customerAmountFromMargin,
} from '@/utils/quoteOptions'

describe('quote defaults', () => {
  it('starts with three single-quantity tiers', () => {
    expect(createDefaultProductTiers()).toEqual([
      { id: 1, minQuantity: 1, maxQuantity: 1, customerUnitPrice: '', purchaseCost: '' },
      { id: 2, minQuantity: 2, maxQuantity: 2, customerUnitPrice: '', purchaseCost: '' },
      { id: 3, minQuantity: 3, maxQuantity: 3, customerUnitPrice: '', purchaseCost: '' },
    ])
  })

  it('calculates customer amounts from gross margin instead of markup', () => {
    expect(customerAmountFromMargin('8.00', 20)).toBe('10.00')
    expect(customerAmountFromMargin('8.00', 100)).toBe('')
    expect(customerAmountFromMargin('', 20)).toBe('')
  })

  it('provides a standard flag asset for every quote destination', () => {
    expect(QUOTE_COUNTRIES.map((country) => country.code)).toEqual(['US', 'GB', 'DE', 'FR', 'CA', 'AU'])
    expect(QUOTE_COUNTRIES.every((country) => country.flagUrl.length > 0)).toBe(true)
  })
})
