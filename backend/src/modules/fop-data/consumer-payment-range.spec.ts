import { consumerPaymentRange } from './consumer-payment-range'
it('uses a rolling seven-day window with inclusive endpoints and no fallback for missing time', () => {
  const now = Date.parse('2026-10-31T04:00:00Z')
  const matches = consumerPaymentRange('1w', now)
  expect(matches('2026-10-24T12:00:00+08:00')).toBe(true)
  expect(matches('2026-10-24T11:59:59.999+08:00')).toBe(false)
  expect(matches(new Date(now).toISOString())).toBe(true)
  expect(matches(new Date(now + 1).toISOString())).toBe(false)
  for (const value of [null, undefined, '', '2026-10-30', 'invalid']) expect(matches(value)).toBe(false)
})
it('clamps calendar months in UTC+8 and includes both exact endpoints', () => {
  const now = Date.parse('2026-03-30T17:00:00Z') // March 31 in UTC+8
  const matches = consumerPaymentRange('1m', now)
  expect(matches('2026-02-28T01:00:00+08:00')).toBe(true)
  expect(matches('2026-02-28T00:59:59.999+08:00')).toBe(false)
  expect(matches(new Date(now).toISOString())).toBe(true)
  expect(matches(new Date(now + 1).toISOString())).toBe(false)
  for (const value of [null, undefined, '', '2026-02-30T01:00:00+08:00', '2026-03-01']) expect(matches(value)).toBe(false)
  expect(consumerPaymentRange('3m', now)('2025-12-31T01:00:00+08:00')).toBe(true)
  expect(consumerPaymentRange('all', now)(null)).toBe(true)
  expect(consumerPaymentRange(undefined, now)(null)).toBe(true)
})
