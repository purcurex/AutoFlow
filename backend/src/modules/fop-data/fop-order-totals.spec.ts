import { moneyToCents } from './fop-order-totals'

describe('money totals use displayed two-decimal amounts', () => {
  it.each([[0.1, 10], [10.075, 1008], [-1.005, -101], [1e-7, 0]])('converts %s to %s cents', (value, expected) => {
    expect(moneyToCents(value)).toBe(expected)
  })
})
