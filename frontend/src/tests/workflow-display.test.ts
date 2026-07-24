import { describe, expect, it } from 'vitest'
import { workflowCreatedDate } from '@/utils/workflowDisplay'

describe('workflow display metadata', () => {
  it('formats the workflow creation date as year-month-day', () => {
    const value = new Date(2026, 6, 24, 10, 30).toISOString()
    expect(workflowCreatedDate(value)).toBe('2026-07-24')
  })

  it('preserves an invalid source value for diagnostics', () => {
    expect(workflowCreatedDate('invalid-date')).toBe('invalid-date')
  })
})
