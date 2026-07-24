import { Injectable } from '@nestjs/common'
import { DEFAULT_GOOGLE_SEARCH_OPTIONS } from '../../autoflow/autoflow.types'
import { ShopifySearchService } from '../../shopify-search/shopify-search.service'
import { normalizeDomain } from '../discovery-normalizer'
import type { DiscoverySeed, NormalizedShopifyStore, StoreDiscoveryAdapter } from '../discovery.types'

@Injectable()
export class ShopifyStoreDiscoveryAdapter implements StoreDiscoveryAdapter {
  constructor(private readonly shopifySearchService: ShopifySearchService) {}

  isGoogleLensConfigured(): boolean {
    return this.shopifySearchService.isGoogleLensConfigured()
  }

  async discover(seed: DiscoverySeed): Promise<NormalizedShopifyStore[]> {
    const results = seed.type === 'image'
      ? await this.shopifySearchService.searchStoresByImageUrl(seed.value, seed.targetMarket)
      : await this.shopifySearchService.searchStoresByKeyword(
          seed.value,
          seed.targetMarket,
          seed.searchOptions || DEFAULT_GOOGLE_SEARCH_OPTIONS,
        )

    const stores: NormalizedShopifyStore[] = results.flatMap((store): NormalizedShopifyStore[] => {
      const normalizedDomain = normalizeDomain(store.url)
      const productUrl = store.productUrl
      if (!normalizedDomain || !productUrl) return []
      const isMock = store.traffic?.source === 'mock'
      const isMyShopifyDomain = normalizedDomain.endsWith('.myshopify.com')

      return [{
        name: store.name.trim() || normalizedDomain,
        domain: normalizedDomain,
        normalizedDomain,
        url: store.url,
        productUrl,
        description: store.description?.trim() || '',
        imageUrl: store.imageUrl || null,
        detectionSource: store.source,
        discoverySources: [store.source],
        validityScore: store.validityScore,
        shopifyConfidence: isMyShopifyDomain ? 90 : 75,
        verificationStatus: isMock ? 'mock' as const : 'probable' as const,
        verificationEvidence: {
          source: store.traffic?.source || 'search_result',
          searchProvider: store.source,
          searchPosition: store.searchPosition,
          productDetailUrl: productUrl,
          googleShopifyQuery: seed.type === 'keyword',
          myShopifyDomain: isMyShopifyDomain,
          mock: isMock,
        },
        verifiedAt: null,
        contacts: [],
        traffic: store.traffic ? { ...store.traffic } : null,
        rawPayload: { ...store, targetMarket: seed.targetMarket },
      }]
    })

    return stores
  }

  async addOwnerFacebookCandidates(
    stores: NormalizedShopifyStore[],
    seed: DiscoverySeed,
  ): Promise<NormalizedShopifyStore[]> {
    const ownerUrls = await Promise.all(stores.slice(0, 5).map((store) => (
      this.shopifySearchService.findOwnerFacebookProfile(store.name, store.normalizedDomain, seed.targetMarket)
    )))
    return stores.map((store, index) => {
      const ownerUrl = ownerUrls[index]
      if (!ownerUrl) return store
      return {
        ...store,
        validityScore: Math.min(100, store.validityScore + 5),
        contacts: [...store.contacts, {
          type: 'facebook',
          value: ownerUrl,
          label: 'Store Owner Facebook Candidate',
          sourceUrl: ownerUrl,
          sourceType: 'google_owner_search',
          verificationStatus: 'observed',
          confidence: 55,
          evidence: {
            queryBasis: 'store name + domain + owner/founder',
            requiresHumanVerification: true,
          },
        }],
      }
    })
  }
}
