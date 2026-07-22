import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FopCapabilities, FopIntegrationMode } from './fop-integration.types'

@Injectable()
export class FopIntegrationService {
  constructor(private readonly configService: ConfigService) {}

  getCapabilities(): FopCapabilities {
    const mode = this.getMode()
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    const sandboxAllowed = mode === 'sandbox' && nodeEnv !== 'production'
    const missingLiveConfiguration = mode === 'live' ? this.missingLiveConfiguration() : []
    const capability = sandboxAllowed
      ? { status: 'available' as const, available: true, reason: 'Development sandbox fixture' }
      : mode === 'live' && missingLiveConfiguration.length > 0
        ? {
            status: 'not_configured' as const,
            available: false,
            reason: `Missing configuration: ${missingLiveConfiguration.join(', ')}`,
          }
        : mode === 'sandbox'
          ? { status: 'unavailable' as const, available: false, reason: 'Sandbox mode is prohibited in production' }
          : { status: 'not_implemented' as const, available: false, reason: 'Live FOP adapter is not implemented' }
    return {
      provider: 'fop',
      platform: 'kingdee-cloud-cosmic',
      mode,
      syntheticData: sandboxAllowed,
      productCost: { ...capability },
      logisticsRate: { ...capability },
      crmHandoff: { ...capability },
    }
  }

  getMode(): FopIntegrationMode {
    const value = this.configService.get<string>('FOP_INTEGRATION_MODE', 'disabled')
    return value === 'sandbox' || value === 'live' ? value : 'disabled'
  }

  isSandboxEnabled(): boolean {
    return this.getMode() === 'sandbox'
      && this.configService.get<string>('NODE_ENV', 'development') !== 'production'
  }

  private missingLiveConfiguration(): string[] {
    return [
      'FOP_BASE_URL',
      'FOP_TENANT_ID',
      'FOP_APP_ID',
      'FOP_APP_SECRET',
      'FOP_PRODUCT_COST_OPERATION',
      'FOP_LOGISTICS_RATE_OPERATION',
      'FOP_CRM_HANDOFF_OPERATION',
    ].filter((key) => !String(this.configService.get(key, '')).trim())
  }
}
