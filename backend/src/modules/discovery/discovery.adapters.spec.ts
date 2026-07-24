import type { PipiAdsService } from '../pipiads/pipiads.service'
import type { ShopifySearchService } from '../shopify-search/shopify-search.service'
import { PipiAdsAdDiscoveryAdapter } from './adapters/pipiads-ad-discovery.adapter'
import { PipiAdsStoreDiscoveryAdapter } from './adapters/pipiads-store-discovery.adapter'
import { ShopifyStoreDiscoveryAdapter } from './adapters/shopify-store-discovery.adapter'

describe('discovery adapters', () => {
  it('routes keyword seeds through PipiAds and marks it as secondary ad evidence', async () => {
    const provider = {
      discover: jest.fn().mockResolvedValue([{
        adId: 'ad-1',
        advertiserName: 'PawSpark',
        adUrl: 'https://www.tiktok.com/@pawspark/video/1',
        sourceUrl: 'https://www.tiktok.com/@pawspark/video/1',
        landingPageUrl: 'https://pawspark.example/products/brush',
        description: 'Active campaign',
        imageUrl: null,
        platform: 'tiktok',
        storeDomain: 'pawspark.example',
        shopType: 'shopify',
        firstSeenAt: null,
        lastSeenAt: null,
        synthetic: false,
        evidenceSource: 'pipiads_api',
        rawPayload: { evidenceAuthority: 'secondary' },
      }]),
    } as unknown as PipiAdsService
    const lensProvider = {
      isGoogleLensConfigured: jest.fn().mockReturnValue(false),
    } as unknown as ShopifySearchService
    const adapter = new PipiAdsAdDiscoveryAdapter(provider, lensProvider)

    const result = await adapter.discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'United States',
    })

    expect(provider.discover).toHaveBeenCalledWith(expect.objectContaining({ value: 'pet brush' }))
    expect(result[0]).toEqual(expect.objectContaining({
      provider: 'pipiads',
      advertiserName: 'PawSpark',
      confidence: 75,
      evidenceSource: 'pipiads_api',
      platform: 'tiktok',
      isDirectAdLink: true,
    }))
  })

  it('derives Shopify candidates from PipiAds landing-page evidence', async () => {
    const provider = {
      discover: jest.fn().mockResolvedValue([{
        adId: 'ad-1', advertiserName: 'PawSpark', adUrl: 'https://example.com/ad/1', sourceUrl: 'https://example.com/ad/1',
        landingPageUrl: 'https://pawspark.example/products/brush', description: 'Campaign', imageUrl: null,
        platform: 'facebook', storeDomain: 'pawspark.example', shopType: 'shopify', firstSeenAt: null,
        lastSeenAt: null, synthetic: false, evidenceSource: 'pipiads_api', rawPayload: {},
      }]),
    } as unknown as PipiAdsService

    const lensAdapter = {
      isGoogleLensConfigured: jest.fn().mockReturnValue(false),
      discover: jest.fn(),
    } as unknown as ShopifyStoreDiscoveryAdapter
    const result = await new PipiAdsStoreDiscoveryAdapter(provider, lensAdapter).discover({
      type: 'keyword', value: 'pet brush', targetMarket: 'US',
    })

    expect(result[0]).toMatchObject({
      normalizedDomain: 'pawspark.example',
      detectionSource: 'pipiads_ad_landing_page',
      shopifyConfidence: 80,
      verificationStatus: 'probable',
      productUrl: 'https://pawspark.example/products/brush',
      discoverySources: ['pipiads'],
    })
    expect(result[0].verificationEvidence).toMatchObject({
      evidenceAuthority: 'secondary',
      requiresOfficialVerification: true,
    })
  })

  it('routes image seeds through Shopify search and removes invalid store URLs', async () => {
    const provider = {
      searchStoresByImageUrl: jest.fn().mockResolvedValue([
        { name: 'PawSpark', url: 'https://www.pawspark.myshopify.com', productUrl: 'https://www.pawspark.myshopify.com/products/brush', source: 'google_lens', validityScore: 90, searchPosition: 1, traffic: { monthlyVisits: 50000, source: 'serpapi_google_lens' } },
        { name: 'Invalid', url: 'not a valid url', productUrl: null, source: 'google_lens', validityScore: 0, searchPosition: null },
      ]),
    } as unknown as ShopifySearchService
    const adapter = new ShopifyStoreDiscoveryAdapter(provider)

    const result = await adapter.discover({
      type: 'image',
      value: 'https://cdn.example/product.jpg',
      targetMarket: 'United States',
    })

    expect(provider.searchStoresByImageUrl).toHaveBeenCalledWith(
      'https://cdn.example/product.jpg',
      'United States',
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      normalizedDomain: 'pawspark.myshopify.com',
      shopifyConfidence: 90,
      verificationStatus: 'probable',
      productUrl: 'https://www.pawspark.myshopify.com/products/brush',
      discoverySources: ['google_lens'],
    }))
  })

  it('falls back to Google Lens stores when PipiAds image discovery has no credits', async () => {
    const provider = {
      discover: jest.fn().mockRejectedValue(new Error('PipiAds credits are insufficient')),
    } as unknown as PipiAdsService
    const lensStore = {
      name: 'Lens Store', domain: 'lens.example', normalizedDomain: 'lens.example',
      url: 'https://lens.example', description: 'Visual match', imageUrl: null,
      detectionSource: 'google_lens', shopifyConfidence: 65, verificationStatus: 'unverified',
      verificationEvidence: { source: 'serpapi_google_lens' }, verifiedAt: null,
      contacts: [], traffic: null, rawPayload: {},
    }
    const lensAdapter = {
      isGoogleLensConfigured: jest.fn().mockReturnValue(true),
      discover: jest.fn().mockResolvedValue([lensStore]),
    } as unknown as ShopifyStoreDiscoveryAdapter
    const lensProvider = {
      isGoogleLensConfigured: jest.fn().mockReturnValue(true),
    } as unknown as ShopifySearchService
    const seed = {
      type: 'image' as const,
      value: 'https://cdn.example/product.jpg',
      targetMarket: 'US',
      searchOptions: {
        exactPhrase: true,
        titleMatch: false,
        excludeMarketplaces: true,
        findOwnerFacebook: false,
      },
    }

    await expect(new PipiAdsAdDiscoveryAdapter(provider, lensProvider).discover(seed)).resolves.toEqual([])
    await expect(new PipiAdsStoreDiscoveryAdapter(provider, lensAdapter).discover(seed)).resolves.toEqual([lensStore])
    expect(lensAdapter.discover).toHaveBeenCalledWith(seed)
  })
})
