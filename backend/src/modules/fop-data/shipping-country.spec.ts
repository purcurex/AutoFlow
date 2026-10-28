import { normalizeShippingCountry } from './shipping-country'

describe('order destination country', () => {
  it.each([[' us ', 'US'], ['gb', 'GB'], ['AU', 'AU'], [null, null], [undefined, null], ['', null], ['USA', null], ['ZZ', null], ['EU', null], ['US<script>', null]])('normalizes %p without guessing a destination', (input, expected) => {
    expect(normalizeShippingCountry(input)).toBe(expected)
  })
})
