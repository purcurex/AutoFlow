export const SOURCING_PROVIDER = 'alibaba_1688' as const
export type SourcingProvider = typeof SOURCING_PROVIDER

export const SOURCING_SEARCH_MODES = ['keyword', 'image'] as const
export type SourcingSearchMode = (typeof SOURCING_SEARCH_MODES)[number]

export const SOURCING_SEARCH_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const
export type SourcingSearchStatus = (typeof SOURCING_SEARCH_STATUSES)[number]

export const SOURCING_PAGE_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const
export type SourcingPageStatus = (typeof SOURCING_PAGE_STATUSES)[number]

export interface SourcingPriceTier {
  minimumQuantity: string
  maximumQuantity?: string | null
  unitPrice: string
  currency: string
}

export interface SourcingScoreReason {
  code: string
  label: string
  score: number
  detail?: string
}

export type SourcingSupplierCapabilities = Record<string, unknown>

/** 1688原始响应必须先完成递归脱敏，再写入该快照字段。 */
export type SourcingRawSnapshot = Record<string, unknown>
