import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { FacebookAdsService } from './facebook-ads.service'

describe('FacebookAdsService provider fallback', () => {
  function service(values: Record<string, string | number | undefined>) {
    const config = {
      get: jest.fn((key: string, fallback?: string | number) => values[key] ?? fallback),
    } as unknown as ConfigService
    return new FacebookAdsService(config)
  }

  it('returns mock ad evidence in development without a provider key', async () => {
    const ads = await service({ NODE_ENV: 'development', SERPAPI_KEY: '' })
      .searchAdsByKeyword('pet brush')

    expect(ads).toHaveLength(3)
    expect(ads.every((ad) => ad.description?.includes('Mock lead'))).toBe(true)
  })

  it('fails closed in production without a provider key', async () => {
    await expect(
      service({ NODE_ENV: 'production', ENABLE_MOCK_SEARCH: 'false', SERPAPI_KEY: '' })
        .searchAdsByKeyword('pet brush'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
