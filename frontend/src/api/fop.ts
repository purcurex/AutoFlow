import api from './index'

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

export const fopApi = {
  getCapabilities(): Promise<FopCapabilities> {
    return api.get('/autoflow/integrations/fop/capabilities')
  },
}
