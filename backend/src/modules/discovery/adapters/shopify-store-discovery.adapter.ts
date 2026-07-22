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

      return [{
        name: store.name.trim() || normalizedDomain,
        domain: normalizedDomain,
        normalizedDomain,
        url: store.url,
        description: store.description?.trim() || '',
        imageUrl: store.imageUrl || null,
        detectionSource: 'shopify_search',
        shopifyConfidence: normalizedDomain.endsWith('.myshopify.com') ? 100 : 85,
        traffic: store.traffic ? { ...store.traffic } : null,
        rawPayload: { ...store, targetMarket: seed.targetMarket },
      }]
    })
  }
}
