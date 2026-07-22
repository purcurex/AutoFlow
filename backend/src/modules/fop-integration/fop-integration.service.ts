import { Injectable } from '@nestjs/common'
import type { FopCapabilities } from './fop-integration.types'

@Injectable()
export class FopIntegrationService {
  getCapabilities(): FopCapabilities {
    const unavailable = { status: 'not_implemented' as const, available: false }
    return {
      provider: 'fop',
      platform: 'kingdee-cloud-cosmic',
      productCost: { ...unavailable },
      logisticsRate: { ...unavailable },
      crmHandoff: { ...unavailable },
    }
  }
}
