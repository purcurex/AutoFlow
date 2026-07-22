import { Injectable } from '@nestjs/common'
import { FacebookAdsService } from '../../facebook-ads/facebook-ads.service'
import type { AdDiscoveryAdapter, DiscoverySeed, NormalizedAdCreative } from '../discovery.types'

@Injectable()
export class FacebookAdsDiscoveryAdapter implements AdDiscoveryAdapter {
  constructor(private readonly facebookAdsService: FacebookAdsService) {}

  async discover(seed: DiscoverySeed): Promise<NormalizedAdCreative[]> {
    const results = seed.type === 'image'
      ? await this.facebookAdsService.searchAdsByImageUrl(seed.value)
      : await this.facebookAdsService.searchAdsByKeyword(seed.value)

    return results.map((ad) => ({
      provider: 'facebook_ads',
      advertiserName: ad.name.trim(),
      sourceUrl: ad.url,
      description: ad.description?.trim() || '',
      imageUrl: ad.imageUrl || null,
      confidence: 60,
      rawPayload: { ...ad, targetMarket: seed.targetMarket },
    }))
  }
}
