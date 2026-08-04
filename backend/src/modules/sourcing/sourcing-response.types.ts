import type { SourcingSearchMode } from './sourcing.types'

export type SourcingApiStatus =
  | 'not_configured'
  | 'idle'
  | 'running'
  | 'failed'
  | 'partial'
  | 'completed'

export interface SourcingSearchResponse {
  id: string
  status: SourcingApiStatus
  searchMode: SourcingSearchMode
  query: string | null
  failureCode: string | null
  failureMessage: string | null
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface SourcingStartResponse {
  searchId: string
  status: 'pending' | 'running' | 'succeeded' | 'partial'
  page: 1
  pageSize: 10 | 20 | 50
}

export interface SourcingPageRequestResponse {
  searchId: string
  status: 'pending' | 'running' | 'succeeded'
  page: number
  pageSize: 10 | 20 | 50
}

export interface SourcingPagination {
  page: number
  pageSize: 10 | 20 | 50
  totalRecords: number | null
  totalPages: number | null
  resultCount: number
  loaded: boolean
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  errorCode: string | null
  errorMessage: string | null
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
  repurchaseRate: string | null
  supplier: {
    companyName: string | null
    shopName: string | null
    shopUrl: string | null
    score: string | null
    identities: string[]
    badges: string[]
  } | null
  recommendationReasons: string[]
}

export interface SourcingWorkflowInputResponse {
  name: string
  seedType: SourcingSearchMode
  seedValue: string
  targetMarket: string
}

export interface SourcingSummaryResponse {
  workflowId: string
  workflowInput: SourcingWorkflowInputResponse
  provider: 'alibaba_1688'
  providerConfigured: boolean
  status: SourcingApiStatus
  search: SourcingSearchResponse | null
  latestSearch: SourcingSearchResponse | null
  pagination: SourcingPagination
  items: SourcingOfferResponse[]
  offers: SourcingOfferResponse[]
}
