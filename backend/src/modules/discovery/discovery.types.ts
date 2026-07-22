import type { LeadContactType, SeedType } from '../autoflow/autoflow.types'

export const STORE_VERIFICATION_STATUSES = [
  'verified',
  'probable',
  'unverified',
  'failed',
  'mock',
] as const
export type StoreVerificationStatus = (typeof STORE_VERIFICATION_STATUSES)[number]

export const CONTACT_VERIFICATION_STATUSES = ['verified', 'observed', 'unverified'] as const
export type ContactVerificationStatus = (typeof CONTACT_VERIFICATION_STATUSES)[number]

export interface NormalizedContactEvidence {
  type: LeadContactType
  value: string
  label: string | null
  sourceUrl: string
  sourceType: string
  verificationStatus: ContactVerificationStatus
  confidence: number
  evidence: Record<string, unknown>
}

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
  verificationStatus: StoreVerificationStatus
  verificationEvidence: Record<string, unknown>
  verifiedAt: string | null
  contacts: NormalizedContactEvidence[]
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
  verificationStatus: StoreVerificationStatus
  description: string
  contacts: NormalizedContactEvidence[]
  adEvidence: Array<{
    provider: string
    sourceUrl: string
    confidence: number
    matchReasons: string[]
  }>
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
