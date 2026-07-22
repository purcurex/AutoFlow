import api from './index'

export type FopCapabilityStatus = 'not_implemented' | 'not_configured' | 'available' | 'unavailable'

export interface FopCapability {
  status: FopCapabilityStatus
  available: boolean
}

export interface FopCapabilities {
  provider: 'fop'
  platform: 'kingdee-cloud-cosmic'
  mode: 'disabled' | 'sandbox' | 'live'
  syntheticData: boolean
  productCost: FopCapability
  logisticsRate: FopCapability
  crmHandoff: FopCapability
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
  getHandoff(leadId: string): Promise<FopHandoff | null> {
    return api.get(`/autoflow/leads/${leadId}/fop-handoff`)
  },
  handoff(leadId: string, reason: string): Promise<FopHandoff> {
    return api.post(`/autoflow/leads/${leadId}/fop-handoff`, { reason })
  },
}
