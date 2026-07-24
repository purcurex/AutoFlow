import type { ConfigService } from '@nestjs/config'
import { FopIntegrationService } from './fop-integration.service'

describe('FopIntegrationService', () => {
  function service(values: Record<string, string> = {}) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    }
    return new FopIntegrationService(config as unknown as ConfigService)
  }

  it('fails closed when FOP integration is disabled', () => {
    expect(service().getCapabilities()).toEqual({
      provider: 'fop',
      platform: 'kingdee-cloud-cosmic',
      mode: 'disabled',
      syntheticData: false,
      productCost: expect.objectContaining({ status: 'not_implemented', available: false }),
      logisticsCatalog: expect.objectContaining({ status: 'not_implemented', available: false }),
      logisticsRate: expect.objectContaining({ status: 'not_implemented', available: false }),
      crmHandoff: expect.objectContaining({ status: 'not_implemented', available: false }),
    })
  })

  it('advertises synthetic fixtures only in non-production sandbox mode', () => {
    const capabilities = service({ FOP_INTEGRATION_MODE: 'sandbox', NODE_ENV: 'test' }).getCapabilities()
    expect(capabilities).toMatchObject({
      mode: 'sandbox',
      syntheticData: true,
      productCost: { status: 'available', available: true },
      logisticsCatalog: { status: 'available', available: true },
      logisticsRate: { status: 'available', available: true },
      crmHandoff: { status: 'available', available: true },
    })
  })

  it('rejects sandbox mode in production', () => {
    const capabilities = service({ FOP_INTEGRATION_MODE: 'sandbox', NODE_ENV: 'production' }).getCapabilities()
    expect(capabilities.syntheticData).toBe(false)
    expect(capabilities.productCost).toMatchObject({ status: 'unavailable', available: false })
  })
})
