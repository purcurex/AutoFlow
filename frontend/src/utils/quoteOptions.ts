import auFlag from 'flag-icons/flags/4x3/au.svg'
import caFlag from 'flag-icons/flags/4x3/ca.svg'
import deFlag from 'flag-icons/flags/4x3/de.svg'
import frFlag from 'flag-icons/flags/4x3/fr.svg'
import gbFlag from 'flag-icons/flags/4x3/gb.svg'
import usFlag from 'flag-icons/flags/4x3/us.svg'

export interface ProductTierDraft {
  id: number
  minQuantity: number
  maxQuantity: number | null
  customerUnitPrice: string
  purchaseCost: string
}

export interface QuoteCountryOption {
  code: string
  flagUrl: string
}

export interface SelectedLogisticsChannelDraft {
  customChannelCode: string
  customChannelName: string
  actualChannelCode: string
  actualChannelName: string
  carrierName?: string
  logisticsProfitMarginRate: number
}

export const QUOTE_COUNTRIES: QuoteCountryOption[] = [
  { code: 'US', flagUrl: usFlag },
  { code: 'GB', flagUrl: gbFlag },
  { code: 'DE', flagUrl: deFlag },
  { code: 'FR', flagUrl: frFlag },
  { code: 'CA', flagUrl: caFlag },
  { code: 'AU', flagUrl: auFlag },
]

export function createDefaultProductTiers(): ProductTierDraft[] {
  return [1, 2, 3].map((quantity) => ({
    id: quantity,
    minQuantity: quantity,
    maxQuantity: quantity,
    customerUnitPrice: '',
    purchaseCost: '',
  }))
}

export function customerAmountFromMargin(cost: string, marginRate: number): string {
  const numericCost = Number(cost)
  if (!Number.isFinite(numericCost) || numericCost <= 0 || marginRate < 0 || marginRate >= 100) return ''
  return (numericCost / (1 - marginRate / 100)).toFixed(2)
}
