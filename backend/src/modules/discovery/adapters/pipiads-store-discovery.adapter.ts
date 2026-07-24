import { Injectable } from '@nestjs/common'
import { PipiAdsService } from '../../pipiads/pipiads.service'
import type { PipiAdsEvidence } from '../../pipiads/pipiads.types'
import { ShopifyStoreDiscoveryAdapter } from './shopify-store-discovery.adapter'
import type { DiscoverySeed, NormalizedShopifyStore, StoreDiscoveryAdapter } from '../discovery.types'

@Injectable()
export class PipiAdsStoreDiscoveryAdapter implements StoreDiscoveryAdapter {
  constructor(
    private readonly pipiAdsService: PipiAdsService,
    private readonly googleAdapter: ShopifyStoreDiscoveryAdapter,
  ) {}

  async discover(seed: DiscoverySeed): Promise<NormalizedShopifyStore[]> {
    let ads: PipiAdsEvidence[] = []
    let pipiAdsError: unknown
    try {
      ads = await this.pipiAdsService.discover(seed)
    } catch (error) {
      pipiAdsError = error
    }

    const pipiAdsStores = ads.flatMap((ad): NormalizedShopifyStore[] => {
      if (!ad.storeDomain || ad.shopType !== 'shopify') return []
      const productUrl = this.productDetailUrl(ad.landingPageUrl)
      if (!productUrl) return []
      const url = `https://${ad.storeDomain}`
      return [{
        name: ad.advertiserName,
        domain: ad.storeDomain,
        normalizedDomain: ad.storeDomain,
        url,
        productUrl,
        description: ad.description,
        imageUrl: ad.imageUrl,
        detectionSource: 'pipiads_ad_landing_page',
        discoverySources: ['pipiads'],
        validityScore: 75,
        shopifyConfidence: 80,
        verificationStatus: ad.synthetic ? 'mock' : 'probable',
        verificationEvidence: {
          provider: 'pipiads',
          evidenceSource: ad.evidenceSource,
          evidenceAuthority: ad.synthetic ? 'mock' : 'secondary',
          requiresOfficialVerification: true,
          providerShopType: ad.shopType,
          adId: ad.adId,
          adUrl: ad.adUrl,
          adSourceUrl: ad.sourceUrl,
          landingPageUrl: ad.landingPageUrl,
          platform: ad.platform,
          firstSeenAt: ad.firstSeenAt,
          lastSeenAt: ad.lastSeenAt,
        },
        verifiedAt: null,
        contacts: [],
        traffic: null,
        rawPayload: ad.rawPayload,
      }]
    })

    let googleStores: NormalizedShopifyStore[] = []
    if (this.googleAdapter.isGoogleLensConfigured()) {
      try {
        googleStores = await this.googleAdapter.discover(seed)
      } catch {
        if (pipiAdsStores.length === 0 && pipiAdsError) throw pipiAdsError
      }
    }

    if (pipiAdsStores.length === 0 && googleStores.length === 0 && pipiAdsError) throw pipiAdsError

    const stores = this.mergeStores([...pipiAdsStores, ...googleStores])
    const ownerLookupNeeded = (seed.searchOptions?.findOwnerFacebook ?? true)
      && this.googleAdapter.isGoogleLensConfigured()
    return ownerLookupNeeded
      ? this.googleAdapter.addOwnerFacebookCandidates(stores, seed)
      : stores
  }

  private mergeStores(stores: NormalizedShopifyStore[]): NormalizedShopifyStore[] {
    const merged = new Map<string, NormalizedShopifyStore>()
    for (const store of stores) {
      const previous = merged.get(store.normalizedDomain)
      if (!previous) {
        merged.set(store.normalizedDomain, store)
        continue
      }
      const contacts = new Map(
        [...previous.contacts, ...store.contacts].map((contact) => [`${contact.type}|${contact.value}`, contact]),
      )
      const discoverySources = [...new Set([...previous.discoverySources, ...store.discoverySources])]
      merged.set(store.normalizedDomain, {
        ...previous,
        productUrl: store.productUrl || previous.productUrl,
        imageUrl: store.imageUrl || previous.imageUrl,
        description: store.description || previous.description,
        detectionSource: discoverySources.join('+'),
        discoverySources,
        validityScore: Math.min(100, Math.max(previous.validityScore, store.validityScore) + 5),
        shopifyConfidence: Math.max(previous.shopifyConfidence, store.shopifyConfidence),
        verificationStatus: store.verificationStatus === 'verified' ? 'verified' : previous.verificationStatus,
        verificationEvidence: {
          ...previous.verificationEvidence,
          mergedEvidence: store.verificationEvidence,
        },
        contacts: [...contacts.values()],
        traffic: store.traffic || previous.traffic,
        rawPayload: { pipiads: previous.rawPayload, google: store.rawPayload },
      })
    }
    return [...merged.values()].sort((left, right) => right.validityScore - left.validityScore)
  }

  private productDetailUrl(value: string | null): string | null {
    if (!value) return null
    try {
      const url = new URL(value)
      return /\/products\/[^/?#]+/i.test(url.pathname) ? url.toString() : null
    } catch {
      return null
    }
  }
}
