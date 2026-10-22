import { describe, expect, it } from 'vitest'
import { sumCompleteMoney, sumMoney } from '@/utils/tableTotals'

describe('table monetary totals', () => {
  it('sums displayed cents, including credits and zero results', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
    expect(sumMoney([10.075, -1.005, 0])).toBe(9.07)
    expect(sumMoney([])).toBe(0)
  })
  it('does not present missing quotes as zero but accepts actual zero quotes', () => {
    for (const missing of [undefined, null, '', ' ', 'not-an-amount', NaN, false]) {
      expect(sumCompleteMoney([10, missing])).toBeNull()
    }
    expect(sumCompleteMoney([])).toBeNull()
    expect(sumCompleteMoney(['0', 0, '0.10', '0.20'])).toBe(0.3)
  })
})
