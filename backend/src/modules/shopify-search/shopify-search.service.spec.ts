import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ShopifySearchService } from './shopify-search.service'

describe('ShopifySearchService provider fallback', () => {
  function service(values: Record<string, string | number | undefined>) {
    const config = {
      get: jest.fn((key: string, fallback?: string | number) => values[key] ?? fallback),
    } as unknown as ConfigService
    return new ShopifySearchService(config)
  }

  it('returns explicitly marked mock stores in development without a provider key', async () => {
    const stores = await service({ NODE_ENV: 'development', SERPAPI_KEY: '' })
      .searchStoresByKeyword('pet brush')

    expect(stores).toHaveLength(3)
    expect(stores.every((store) => store.traffic?.source === 'mock')).toBe(true)
  })

  it('fails closed in production without a provider key', async () => {
    await expect(
      service({ NODE_ENV: 'production', ENABLE_MOCK_SEARCH: 'false', SERPAPI_KEY: '' })
        .searchStoresByKeyword('pet brush'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
