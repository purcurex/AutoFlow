import {
  decimalMinMax,
  decimalOrNull,
  decimalPercentOrNull,
} from './sourcing-decimal'

describe('sourcing decimal helpers', () => {
  it('preserves values beyond JavaScript safe integer precision', () => {
    expect(decimalOrNull('9007199254740993.12345')).toBe('9007199254740993.1235')
  })

  it('finds minimum and maximum without converting to number', () => {
    expect(decimalMinMax(['10.0000000001', '9.9999999999', null])).toEqual({
      minimum: '9.9999999999',
      maximum: '10.0000000001',
    })
  })

  it('normalizes percentages and rejects negative or out-of-range values', () => {
    expect(decimalPercentOrNull('48.125%')).toBe('48.1250')
    expect(decimalPercentOrNull('-1')).toBeNull()
    expect(decimalPercentOrNull('101')).toBeNull()
  })
})
