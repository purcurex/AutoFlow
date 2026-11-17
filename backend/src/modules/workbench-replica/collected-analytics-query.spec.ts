import { analyticsWindow, collectedAnalyticsQuery } from './collected-analytics-query'

describe('collected analytics UTC+8 window', () => {
  it('keeps both requested calendar dates inclusive with an exclusive UTC end', () => {
    expect(analyticsWindow({ from: '2026-11-01', to: '2026-11-12' })).toEqual({ from: '2026-11-01', to: '2026-11-12', start: '2026-10-31T16:00:00.000Z', end: '2026-11-12T16:00:00.000Z', timezone: 'Asia/Shanghai' })
  })
  it.each([{from:'2025-12-31',to:'2026-01-01'}, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-11-12', to: '2026-11-01' }, { from: '2025-01-01', to: '2026-01-02' }, { from: '2026-1-01', to: '2026-01-01' }, {}])('rejects invalid or unbounded dates: %j', query => {
    expect(() => analyticsWindow(query)).toThrow()
  })
  it('accepts a leap year of 366 days', () => { expect(analyticsWindow({ from: '2028-01-01', to: '2028-12-31' }).end).toBe('2028-12-31T16:00:00.000Z') })
})

describe('local analytics SQL isolation', () => {
  const query = () => collectedAnalyticsQuery({ batchId: 'batch', companyId: '100000', employeeIds: ['70'], members: [{ employeeId: '70', departmentId: 'd1' }], window: analyticsWindow({ from: '2026-11-01', to: '2026-11-12' }), summaryOnly: false, availableQueues: ['unpaid', 'review'] })
  it('scopes both facts and orders before aggregating and parameterizes all caller values', () => {
    const q = query()
    expect(q.params).toContain('100000')
    expect(q.params).toContainEqual(['70'])
    expect(q.sql).toContain('company_id =')
    expect(q.sql).toContain('owner_employee_id = ANY(')
    expect(q.sql).not.toContain('100000')
    expect(q.sql).toContain("f.facts->'scope'->>'verified' = 'true'")
    expect(q.sql).toContain("f.facts->>'sourceOwnershipVerified' = 'true'")
    expect(q.sql).not.toMatch(/SELECT\s+\*|customer_id|document_number|ownerName|salesperson/)
  })
  it('returns explicit zero pending counts even when the authorized order scope is empty', () => {
    const q = query()
    const pending = q.sql.slice(q.sql.indexOf('pending AS'), q.sql.indexOf('paid_summary AS'))
    expect(pending).not.toContain('GROUP BY department_id')
    expect(pending).toContain('ELSE NULL::int END AS count')
  })
  it('keeps current pending predicates independent of historical payment dates', () => {
    const q = query()
    const current = q.sql.slice(q.sql.indexOf('current_orders AS'), q.sql.indexOf('scoped_facts AS'))
    expect(current).not.toContain('paid_at >=')
    expect(current).toContain("raw_order_status IN ('no','1')")
    expect(current).toContain("IS DISTINCT FROM 'fulfilled'")
    expect(current).toContain("raw_order_status='2' AND raw_bill_status IN ('A','B')")
    expect(q.sql).toContain("AT TIME ZONE 'Asia/Shanghai'")
    expect(q.sql).not.toContain('source_paid_at')
  })
  it('keeps money and quantity as decimal strings, and excludes untrusted dispatch costs', () => {
    const q = query()
    expect(q.sql).toContain('sum(quantity)::text')
    expect(q.sql).toContain('sum(amount)::text')
    expect(q.sql).toContain("raw_status = 'C'")
    expect(q.sql).toContain('currency_code IS NOT NULL')
    expect(q.sql).not.toContain("'USD'")
    expect(q.sql).not.toContain('coalesce(sum(amount),0)')
  })
})
