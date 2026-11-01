import { normalizeOrderAmountBreakdown } from './order-amount-breakdown'

describe('order amount tax', () => {
  it('preserves the stored tax and whitelists only amount fields', () => {
    expect(normalizeOrderAmountBreakdown({ productAmount: 100, shippingFee: 12, taxAmount: 2.5, discountAmount: 5, internal: 'private' }))
      .toEqual({ productAmount: 100, shippingFee: 12, taxAmount: 2.5, discountAmount: 5 })
  })
  it('preserves a confirmed zero tax', () => {
    expect(normalizeOrderAmountBreakdown({ taxAmount: 0 })).toMatchObject({ taxAmount: 0 })
  })
  it.each([undefined, null, NaN, Infinity, '', '2.5', true])('keeps missing or invalid tax unknown: %s', taxAmount => {
    expect(normalizeOrderAmountBreakdown({ productAmount: 100, taxAmount })).toEqual({ productAmount: 100, shippingFee: null, taxAmount: null, discountAmount: null })
  })
})
