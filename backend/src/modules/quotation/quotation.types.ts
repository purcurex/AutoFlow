export interface QuoteRequestSnapshot {
  currency: string
  products: Array<{
    lineId: string
    productReference: string
    unit: string
    quantityTiers: Array<{
      minQuantity: number
      maxQuantity?: number
      customerUnitPrice: string
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
}

export interface QuoteResultSnapshot {
  productCost?: Record<string, unknown>
  logisticsRates?: Record<string, unknown>
  combinedMatrix?: Record<string, unknown>
}
