export interface QuoteRequestSnapshot {
  currency: string
  products: Array<{
    lineId: string
    productReference: string
    unit: string
    productProfitMarginRate: number
    quantityTiers: Array<{
      minQuantity: number
      maxQuantity?: number
      customerUnitPrice: string
      purchaseCost?: string
    }>
  }>
  destinationCountries: string[]
  packages: Array<{
    quantity: number
    weight: number
    weightUnit: string
    length: number
    width: number
    height: number
    dimensionUnit: string
  }>
  logisticsChannels: Array<{
    customChannelCode: string
    customChannelName: string
    actualChannelCode: string
    actualChannelName: string
    carrierName?: string
    logisticsProfitMarginRate: number
  }>
}

export interface QuoteCombinedMatrixRow {
  lineId: string
  productReference: string
  minQuantity: number
  maxQuantity?: number
  countryCode: string
  customChannelCode: string
  actualChannelCode: string
  productProfitMarginRate: number
  logisticsProfitMarginRate: number
  purchaseCost: string | null
  customerProductUnitPrice: string
  baseFreightAmount: string | null
  customerFreightAmount: string | null
  combinedAmount: string | null
  currency: string
}

export interface QuoteResultSnapshot {
  productCost?: Record<string, unknown>
  logisticsRates?: Record<string, unknown>
  combinedMatrix?: QuoteCombinedMatrixRow[]
  providerErrors?: {
    productCost?: string
    logisticsRates?: string
  }
}
