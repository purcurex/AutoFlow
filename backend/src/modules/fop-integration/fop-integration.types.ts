export type FopCapabilityStatus = 'not_implemented' | 'not_configured' | 'available' | 'unavailable'

export interface FopCapability {
  status: FopCapabilityStatus
  available: boolean
}

export interface FopCapabilities {
  provider: 'fop'
  platform: 'kingdee-cloud-cosmic'
  productCost: FopCapability
  logisticsRate: FopCapability
  crmHandoff: FopCapability
}

export interface ProductCostRequest {
  idempotencyKey: string
  correlationId: string
  currency: string
  items: Array<{
    lineId: string
    productReference: string
    unit: string
    quantityTiers: Array<{ minQuantity: number; maxQuantity?: number }>
  }>
}

export interface ProductCostResult {
  provider: 'fop'
  externalRequestId: string
  sourceVersion: string
  effectiveAt: string
  expiresAt?: string
  currency: string
  items: Array<{
    lineId: string
    productReference: string
    tiers: Array<{ minQuantity: number; maxQuantity?: number; unitCost: string }>
  }>
}

export interface ShippingRateRequest {
  idempotencyKey: string
  correlationId: string
  currency: string
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

export interface ShippingRateResult {
  provider: 'fop'
  externalRequestId: string
  sourceVersion: string
  effectiveAt: string
  expiresAt?: string
  currency: string
  destinations: Array<{
    countryCode: string
    options: Array<{
      channelCode: string
      channelName: string
      chargeableWeight: number
      freightAmount: string
      minTransitDays?: number
      maxTransitDays?: number
    }>
  }>
}

export interface ProspectHandoffRequest {
  idempotencyKey: string
  correlationId: string
  autoFlowLeadId: string
  handoffReason: string
}

export interface ProspectHandoffResult {
  fopLeadId: string
  fopOpportunityId?: string
  syncStatus: 'succeeded' | 'requires_review'
  conflicts: string[]
  updatedAt: string
}

export abstract class FopProductCostPort {
  abstract getProductCosts(request: ProductCostRequest): Promise<ProductCostResult>
}

export abstract class FopLogisticsRatePort {
  abstract getShippingRates(request: ShippingRateRequest): Promise<ShippingRateResult>
}

export abstract class FopCrmHandoffPort {
  abstract handoffProspect(request: ProspectHandoffRequest): Promise<ProspectHandoffResult>
}
