import api from './index'

export type FopCapabilityStatus = 'not_implemented' | 'not_configured' | 'available' | 'unavailable'

export interface FopCapability {
  status: FopCapabilityStatus
  available: boolean
  reason?: string
}

export interface FopCapabilities {
  provider: 'fop'
  platform: 'kingdee-cloud-cosmic'
  mode: 'disabled' | 'sandbox' | 'live'
  syntheticData: boolean
  productCost: FopCapability
  logisticsCatalog: FopCapability
  logisticsRate: FopCapability
  crmHandoff: FopCapability
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

export interface FopProductCostResult {
  provider: 'fop'
  sourceVersion: string
  effectiveAt: string
  currency: string
  items: Array<{
    lineId: string
    productReference: string
    tiers: Array<{
      minQuantity: number
      maxQuantity?: number
      unitCost: string
      customerUnitPrice?: string
      suggestedCustomerUnitPrice: string
      appliedProfitMarginRate?: number
    }>
  }>
  warnings: string[]
}

export interface FopHandoff {
  id: string
  leadId: string
  status: 'pending' | 'succeeded' | 'requires_review' | 'failed' | 'unavailable'
  fopLeadId: string | null
  fopOpportunityId: string | null
  conflicts: string[]
  lastError: string | null
  attempts: number
  lastSyncedAt: string | null
}

export const fopApi = {
  getCapabilities(): Promise<FopCapabilities> {
    return api.get('/autoflow/integrations/fop/capabilities')
  },
  getProductPurchaseCosts(payload: {
    lineId: string
    productReference: string
    unit: string
    currency: string
    productProfitMarginRate: number
    quantityTiers: Array<{ minQuantity: number; maxQuantity?: number }>
  }): Promise<FopProductCostResult> {
    return api.post('/autoflow/integrations/fop/products/purchase-costs', payload)
  },
  getCustomLogisticsChannels(): Promise<FopCustomLogisticsChannelResult> {
    return api.get('/autoflow/integrations/fop/logistics/custom-channels')
  },
  getActualLogisticsChannels(customChannelCode: string): Promise<FopActualLogisticsChannelResult> {
    return api.get(`/autoflow/integrations/fop/logistics/custom-channels/${encodeURIComponent(customChannelCode)}/actual-channels`)
  },
  getHandoff(leadId: string): Promise<FopHandoff | null> {
    return api.get(`/autoflow/leads/${leadId}/fop-handoff`)
  },
  handoff(leadId: string, reason: string): Promise<FopHandoff> {
    return api.post(`/autoflow/leads/${leadId}/fop-handoff`, { reason })
  },
}
