import { ISO_COUNTRY_CODES } from './shipping-country'
import { COUNTRY_FLAGS } from './countryFlags'
const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' })
export const COMMON_COUNTRY_CODES = ['US', 'GB', 'DE', 'FR', 'CA', 'AU']
export const COUNTRIES = ISO_COUNTRY_CODES.map(code => ({ code, name: names.of(code) || code, flagUrl: COUNTRY_FLAGS[code]! }))
export function searchCountries(search: string) {
  const term = search.trim().toLocaleLowerCase()
  return COUNTRIES.filter(c => c.code.toLowerCase().includes(term) || c.name.includes(term))
}
export function findCountry(value?: string | null) {
  return COUNTRIES.find(c => c.code === value?.trim().toUpperCase() || c.name === value?.trim())
}
