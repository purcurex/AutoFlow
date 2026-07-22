import { FopIntegrationService } from './fop-integration.service'

describe('FopIntegrationService', () => {
  it('fails closed until real Kingdee Cloud Cosmic adapters are implemented', () => {
    const capabilities = new FopIntegrationService().getCapabilities()

    expect(capabilities).toEqual({
      provider: 'fop',
      platform: 'kingdee-cloud-cosmic',
      productCost: { status: 'not_implemented', available: false },
      logisticsRate: { status: 'not_implemented', available: false },
      crmHandoff: { status: 'not_implemented', available: false },
    })
  })
})
