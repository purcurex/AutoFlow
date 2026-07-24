export type FopCapabilityStatus = 'not_implemented' | 'not_configured' | 'available' | 'unavailable'
export type FopIntegrationMode = 'disabled' | 'sandbox' | 'live'

export interface FopCapability {
  status: FopCapabilityStatus
  available: boolean
  reason?: string
}

export interface FopCapabilities {
  provider: 'fop'
  platform: 'kingdee-cloud-cosmic'
  mode: FopIntegrationMode
  syntheticData: boolean
  productCost: FopCapability
  logisticsCatalog: FopCapability
  logisticsRate: FopCapability
  crmHandoff: FopCapability
}

export interface ProductCostRequest {
  idempotencyKey: string
  correlationId: string
  currency: string
  pricingContext?: {
    customerReference?: string
    salesOrganizationReference?: string
    pricePolicyReference?: string
  }
  items: Array<{
    lineId: string
    productReference: string
    unit: string
    productProfitMarginRate?: number
    quantityTiers: Array<{ minQuantity: number; maxQuantity?: number }>
  }>
}

export interface ProductCostResult {
  provider: 'fop'
  externalRequestId: string
  sourceVersion: string
  pricingPolicyVersion: string
  effectiveAt: string
  expiresAt?: string
  currency: string
  exchangeRate?: {
    sourceCurrency: string
    targetCurrency: string
    rate: string
    sourceVersion: string
    effectiveAt: string
  }
  items: Array<{
    lineId: string
    productReference: string
    tiers: Array<{
      minQuantity: number
      maxQuantity?: number
      unitCost: string
      suggestedCustomerUnitPrice: string
      costComponents: Array<{ code: string; name: string; amount: string }>
      grossMarginRate: string
      appliedProfitMarginRate?: number
      customerUnitPrice?: string
      pricePolicyReference?: string
      approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected'
      returnedFees?: Array<{ code: string; name: string; amount: string }>
    }>
  }>
  warnings: string[]
}

export interface FopCustomLogisticsChannel {
  code: string
  name: string
  enabled: boolean
  sortOrder?: number
}

export interface FopActualLogisticsChannel {
  customChannelCode: string
  code: string
  name: string
  enabled: boolean
  carrierName?: string
  serviceLevel?: string
  supportedCountries?: string[]
}

export interface FopCustomLogisticsChannelResult {
  provider: 'fop'
  sourceVersion: string
  effectiveAt: string
  channels: FopCustomLogisticsChannel[]
  warnings: string[]
}

export interface FopActualLogisticsChannelResult {
  provider: 'fop'
  sourceVersion: string
  effectiveAt: string
  customChannelCode: string
  channels: FopActualLogisticsChannel[]
  warnings: string[]
}

export interface ShippingRateRequest {
  idempotencyKey: string
  correlationId: string
  currency: string
  originReference?: string
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
  productContext: Array<{
    productReference: string
    quantity: number
    unit: string
  }>
  selectedChannels: Array<{
    customChannelCode: string
    customChannelName: string
    actualChannelCode: string
    actualChannelName: string
    logisticsProfitMarginRate: number
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
    status: 'available' | 'unsupported' | 'partial'
    options: Array<{
      customChannelCode: string
      customChannelName: string
      channelCode: string
      channelName: string
      chargeableWeight: number
      freightAmount: string
      logisticsProfitMarginRate?: number
      customerFreightAmount?: string
      returnedFees?: Array<{ code: string; name: string; amount: string }>
      minTransitDays?: number
      maxTransitDays?: number
      restrictions?: string[]
    }>
  }>
  warnings: string[]
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

export abstract class FopLogisticsCatalogPort {
  abstract getCustomChannels(): Promise<FopCustomLogisticsChannelResult>
  abstract getActualChannels(customChannelCode: string): Promise<FopActualLogisticsChannelResult>
}

export abstract class FopCrmHandoffPort {
  abstract handoffProspect(request: ProspectHandoffRequest): Promise<ProspectHandoffResult>
}
