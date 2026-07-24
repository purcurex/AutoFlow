import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { ShopifySearchService } from './shopify-search.service'

describe('ShopifySearchService provider fallback', () => {
  afterEach(() => jest.restoreAllMocks())

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

  it('uses the Google Lens visual-matches endpoint for image discovery', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        visual_matches: [{
          position: 1,
          title: 'Pet Brush Store',
          link: 'https://pawspark.example/products/pet-brush',
          source: 'PawSpark',
          image: 'https://cdn.example/pet-brush.jpg',
        }],
      },
    })

    const stores = await service({ SERPAPI_KEY: 'test-key', NODE_ENV: 'production' })
      .searchStoresByImageUrl('https://cdn.example/input.jpg', 'United States')

    expect(get).toHaveBeenCalledWith('https://serpapi.com/search.json', expect.objectContaining({
      params: expect.objectContaining({
        engine: 'google_lens',
        type: 'visual_matches',
        url: 'https://cdn.example/input.jpg',
        q: 'Shopify product',
        auto_crop: true,
        country: 'us',
      }),
    }))
    expect(stores[0]).toMatchObject({
      name: 'PawSpark',
      url: 'https://pawspark.example',
      productUrl: 'https://pawspark.example/products/pet-brush',
      imageUrl: 'https://cdn.example/pet-brush.jpg',
      source: 'google_lens',
      traffic: { source: 'serpapi_google_lens' },
    })
  })

  it('excludes marketplace product pages from Shopify image results', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        visual_matches: [
          { position: 1, title: 'Marketplace result', link: 'https://www.joom.com/products/unrelated' },
          { position: 2, title: 'Shopify result', link: 'https://pawspark.example/products/pet-brush' },
        ],
      },
    })

    const stores = await service({ SERPAPI_KEY: 'test-key', NODE_ENV: 'production' })
      .searchStoresByImageUrl('https://cdn.example/input.jpg', 'United States')

    expect(stores.map((store) => store.url)).toEqual(['https://pawspark.example'])
  })

  it('builds a Shopify product-page query with supported Google operators', () => {
    const query = service({ SERPAPI_KEY: 'test-key' }).buildShopifyProductQuery('pet brush', {
      exactPhrase: true,
      titleMatch: false,
      excludeMarketplaces: true,
      findOwnerFacebook: true,
    })

    expect(query).toContain('"pet brush"')
    expect(query).toContain('inurl:/products/')
    expect(query).toContain('"Powered by Shopify"')
    expect(query).toContain('-site:amazon.com')
  })

  it('returns only a profile-shaped Facebook owner candidate', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        organic_results: [
          { link: 'https://www.facebook.com/groups/paw-spark' },
          { link: 'https://www.facebook.com/jane.founder' },
        ],
      },
    })

    await expect(service({ SERPAPI_KEY: 'test-key' }).findOwnerFacebookProfile(
      'PawSpark',
      'pawspark.example',
      'United States',
    )).resolves.toBe('https://www.facebook.com/jane.founder')
  })

  it('sorts Google Shopify product results by validity evidence', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        organic_results: [
          { position: 8, title: 'Pet Brush', link: 'https://later.example/products/brush' },
          { position: 1, title: 'Pet Brush | Powered by Shopify', link: 'https://top.myshopify.com/products/brush' },
        ],
      },
    })

    const stores = await service({ SERPAPI_KEY: 'test-key', NODE_ENV: 'production' })
      .searchStoresByKeyword('pet brush', 'United States', {
        exactPhrase: true,
        titleMatch: false,
        excludeMarketplaces: true,
        findOwnerFacebook: true,
      })

    expect(get).toHaveBeenCalledWith('https://serpapi.com/search', expect.objectContaining({
      params: expect.objectContaining({ q: expect.stringContaining('inurl:/products/'), gl: 'us' }),
    }))
    expect(stores.map((store) => store.url)).toEqual([
      'https://top.myshopify.com',
      'https://later.example',
    ])
    expect(stores.every((store) => store.productUrl?.includes('/products/'))).toBe(true)
  })
})
