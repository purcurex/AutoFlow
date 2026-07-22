import type { FacebookAdsService } from '../facebook-ads/facebook-ads.service'
import type { ShopifySearchService } from '../shopify-search/shopify-search.service'
import { FacebookAdsDiscoveryAdapter } from './adapters/facebook-ads-discovery.adapter'
import { ShopifyStoreDiscoveryAdapter } from './adapters/shopify-store-discovery.adapter'

describe('discovery adapters', () => {
  it('routes keyword seeds through the Facebook Ads provider and normalizes output', async () => {
    const provider = {
      searchAdsByKeyword: jest.fn().mockResolvedValue([{
        name: 'PawSpark Ads',
        url: 'https://facebook.example/library/pawspark',
        description: 'Active campaign',
      }]),
    } as unknown as FacebookAdsService
    const adapter = new FacebookAdsDiscoveryAdapter(provider)

    const result = await adapter.discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'United States',
    })

    expect(provider.searchAdsByKeyword).toHaveBeenCalledWith('pet brush')
    expect(result[0]).toEqual(expect.objectContaining({
      provider: 'facebook_ads',
      advertiserName: 'PawSpark Ads',
      confidence: 60,
    }))
  })

  it('routes image seeds through Shopify search and removes invalid store URLs', async () => {
    const provider = {
      searchStoresByImageUrl: jest.fn().mockResolvedValue([
        { name: 'PawSpark', url: 'https://www.pawspark.myshopify.com', traffic: { monthlyVisits: 50000 } },
        { name: 'Invalid', url: 'not a valid url' },
      ]),
    } as unknown as ShopifySearchService
    const adapter = new ShopifyStoreDiscoveryAdapter(provider)

    const result = await adapter.discover({
      type: 'image',
      value: 'https://cdn.example/product.jpg',
      targetMarket: 'United States',
    })

    expect(provider.searchStoresByImageUrl).toHaveBeenCalledWith('https://cdn.example/product.jpg')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      normalizedDomain: 'pawspark.myshopify.com',
      shopifyConfidence: 90,
      verificationStatus: 'probable',
    }))
  })
})
