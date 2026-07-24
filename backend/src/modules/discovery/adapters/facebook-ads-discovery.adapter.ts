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
      evidenceSource: 'facebook_ads_search',
      platform: 'facebook' as const,
      adId: this.adId(ad.url),
      advertiserName: ad.name.trim(),
      sourceUrl: ad.url,
      isDirectAdLink: /facebook\.com\/ads\/library/i.test(ad.url),
      description: ad.description?.trim() || '',
      imageUrl: ad.imageUrl || null,
      confidence: 60,
      rawPayload: {
        ...ad,
        targetMarket: seed.targetMarket,
        evidenceSource: 'facebook_ads_search',
        platform: 'facebook',
        adId: this.adId(ad.url),
        isDirectAdLink: /facebook\.com\/ads\/library/i.test(ad.url),
      },
    }))
  }

  private adId(value: string): string | null {
    try {
      return new URL(value).searchParams.get('id')
    } catch {
      return null
    }
  }
}
