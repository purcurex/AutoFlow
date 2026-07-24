export interface PipiAdsDiscoveryInput {
  type: 'keyword' | 'image'
  value: string
  targetMarket: string
}

export interface PipiAdsEvidence {
  adId: string
  advertiserName: string
  adUrl: string | null
  sourceUrl: string
  landingPageUrl: string | null
  description: string
  imageUrl: string | null
  platform: 'facebook' | 'instagram' | 'tiktok' | 'unknown'
  storeDomain: string | null
  shopType: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  synthetic: boolean
  evidenceSource: 'pipiads_api' | 'pipiads_mock'
  rawPayload: Record<string, unknown>
}
