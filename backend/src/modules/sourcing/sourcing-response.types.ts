import type { SourcingSearchMode } from './sourcing.types'

export type SourcingApiStatus =
  | 'not_configured'
  | 'idle'
  | 'running'
  | 'failed'
  | 'completed'

export interface SourcingSearchResponse {
  id: string
  status: SourcingApiStatus
  searchMode: SourcingSearchMode
  query: string | null
  failureCode: string | null
  failureMessage: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface SourcingOfferResponse {
  id: string
  providerOfferId: string
  sourcingScore: number
  imageUrl: string | null
  chineseTitle: string | null
  foreignTitle: string | null
  title: string
  offerUrl: string
  currency: string
  priceMin: string | null
  priceMax: string | null
  moq: string | null
  unit: string | null
  salesVolume: string | null
  repurchaseRate: number | null
  supplier: {
    companyName: string | null
    shopName: string | null
    shopUrl: string | null
    score: number | null
    identities: string[]
    badges: string[]
  } | null
  recommendationReasons: string[]
}

export interface SourcingSummaryResponse {
  workflowId: string
  provider: 'alibaba_1688'
  providerConfigured: boolean
  status: SourcingApiStatus
  latestSearch: SourcingSearchResponse | null
  offers: SourcingOfferResponse[]
}
