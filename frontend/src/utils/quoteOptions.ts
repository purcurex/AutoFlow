import { COUNTRIES } from './countries'

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

export const QUOTE_COUNTRIES: QuoteCountryOption[] = COUNTRIES

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
