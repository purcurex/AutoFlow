import { describe, expect, it } from 'vitest'
import { formatReceiptChange, receiptChanges, totalReceiptChange } from '@/utils/receiptChanges'

describe('monthly receipt comparisons', () => {
  it('does not treat an absent December baseline or a missing calendar month as zero', () => {
    const changes = receiptChanges({ id: 'department', amounts: [100, 150, 250], previousAmount: 50 }, ['2026-01', '2026-02', '2026-04'], '2024-12')
    expect(changes.map(item => item.delta)).toEqual([null, 50, null])
    expect(formatReceiptChange(changes[0]).percent).toBe('无上月数据')
    expect(totalReceiptChange(changes)).toEqual({ delta: 50, previous: 100, percent: 50 })
  })
  it('calculates differences in cents and distinguishes zero baselines from zero growth', () => {
    const changes = receiptChanges({ id: 'person', amounts: [0.3, 0, 0, 0.1], previousAmount: 0.2 }, ['2026-01', '2026-02', '2026-03', '2026-04'], '2025-12')
    expect(changes[0]).toEqual({ delta: 0.1, previous: 0.2, percent: 50 })
    expect(formatReceiptChange(changes[0])).toMatchObject({ amount: '+$0.10', percent: '+50.00%' })
    expect(formatReceiptChange(changes[1]).percent).toBe('-100.00%')
    expect(formatReceiptChange(changes[2]).percent).toBe('0.00%')
    expect(formatReceiptChange(changes[3])).toMatchObject({ amount: '+$0.10', percent: '—（上月为0）' })
  })
})
