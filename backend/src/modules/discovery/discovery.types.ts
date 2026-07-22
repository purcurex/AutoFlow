import type { SeedType } from '../autoflow/autoflow.types'

export interface DiscoverySeed {
  type: SeedType
  value: string
  targetMarket: string
}

export interface NormalizedAdCreative {
  provider: string
  advertiserName: string
  sourceUrl: string
  description: string
  imageUrl: string | null
  confidence: number
  rawPayload: Record<string, unknown>
}

export interface NormalizedShopifyStore {
  name: string
  domain: string
  normalizedDomain: string
  url: string
  description: string
  imageUrl: string | null
  detectionSource: string
  shopifyConfidence: number
  traffic: Record<string, unknown> | null
  rawPayload: Record<string, unknown>
}

export interface LeadCandidate {
  brandName: string
  domain: string
  normalizedDomain: string
  storeUrl: string
  source: string
  shopifyConfidence: number
  trafficScore: number
}

export interface DiscoveryEvidenceResult {
  workflowRunId: string
  ads: NormalizedAdCreative[]
  stores: NormalizedShopifyStore[]
  candidates: LeadCandidate[]
}

export interface AdDiscoveryAdapter {
  discover(seed: DiscoverySeed): Promise<NormalizedAdCreative[]>
}

export interface StoreDiscoveryAdapter {
  discover(seed: DiscoverySeed): Promise<NormalizedShopifyStore[]>
}

export const AD_DISCOVERY_ADAPTER = Symbol('AD_DISCOVERY_ADAPTER')
export const STORE_DISCOVERY_ADAPTER = Symbol('STORE_DISCOVERY_ADAPTER')
