import { Injectable } from '@nestjs/common'
import { ShopifySearchService } from '../../shopify-search/shopify-search.service'
import { normalizeDomain } from '../discovery-normalizer'
import type { DiscoverySeed, NormalizedShopifyStore, StoreDiscoveryAdapter } from '../discovery.types'

@Injectable()
export class ShopifyStoreDiscoveryAdapter implements StoreDiscoveryAdapter {
  constructor(private readonly shopifySearchService: ShopifySearchService) {}

  async discover(seed: DiscoverySeed): Promise<NormalizedShopifyStore[]> {
    const results = seed.type === 'image'
      ? await this.shopifySearchService.searchStoresByImageUrl(seed.value)
      : await this.shopifySearchService.searchStoresByKeyword(seed.value)

    return results.flatMap((store) => {
      const normalizedDomain = normalizeDomain(store.url)
      if (!normalizedDomain) return []
      const isMock = store.traffic?.source === 'mock'
      const isMyShopifyDomain = normalizedDomain.endsWith('.myshopify.com')

      return [{
        name: store.name.trim() || normalizedDomain,
        domain: normalizedDomain,
        normalizedDomain,
        url: store.url,
        description: store.description?.trim() || '',
        imageUrl: store.imageUrl || null,
        detectionSource: 'shopify_search',
        shopifyConfidence: isMyShopifyDomain ? 90 : 65,
        verificationStatus: isMock ? 'mock' : isMyShopifyDomain ? 'probable' : 'unverified',
        verificationEvidence: {
          source: 'search_result',
          myShopifyDomain: isMyShopifyDomain,
          mock: isMock,
        },
        verifiedAt: null,
        contacts: [{
          type: 'website',
          value: store.url,
          label: 'Storefront',
          sourceUrl: store.url,
          sourceType: 'search_result',
          verificationStatus: isMock ? 'unverified' : 'observed',
          confidence: isMyShopifyDomain ? 80 : 60,
          evidence: { normalizedDomain },
        }],
        traffic: store.traffic ? { ...store.traffic } : null,
        rawPayload: { ...store, targetMarket: seed.targetMarket },
      }]
    })
  }
}
