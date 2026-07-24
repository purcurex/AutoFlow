import { Injectable } from '@nestjs/common'
import { PipiAdsService } from '../../pipiads/pipiads.service'
import type { PipiAdsEvidence } from '../../pipiads/pipiads.types'
import { ShopifySearchService } from '../../shopify-search/shopify-search.service'
import type { AdDiscoveryAdapter, DiscoverySeed, NormalizedAdCreative } from '../discovery.types'

@Injectable()
export class PipiAdsAdDiscoveryAdapter implements AdDiscoveryAdapter {
  constructor(
    private readonly pipiAdsService: PipiAdsService,
    private readonly shopifySearchService: ShopifySearchService,
  ) {}

  async discover(seed: DiscoverySeed): Promise<NormalizedAdCreative[]> {
    let ads: PipiAdsEvidence[]
    try {
      ads = await this.pipiAdsService.discover(seed)
    } catch (error) {
      if (seed.type !== 'image' || !this.shopifySearchService.isGoogleLensConfigured()) throw error
      return []
    }
    return ads.map((ad) => ({
      provider: 'pipiads',
      evidenceSource: ad.evidenceSource,
      platform: ad.platform,
      adId: ad.adId,
      advertiserName: ad.advertiserName,
      sourceUrl: ad.adUrl || ad.sourceUrl,
      isDirectAdLink: Boolean(ad.adUrl),
      description: ad.description,
      imageUrl: ad.imageUrl,
      confidence: ad.synthetic ? 0 : ad.sourceUrl && ad.storeDomain ? 75 : 60,
      rawPayload: ad.rawPayload,
    }))
  }
}
