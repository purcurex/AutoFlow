export const SOURCING_PROVIDER = 'alibaba_1688' as const
export type SourcingProvider = typeof SOURCING_PROVIDER

export const SOURCING_SEARCH_MODES = ['keyword', 'image'] as const
export type SourcingSearchMode = (typeof SOURCING_SEARCH_MODES)[number]

export const SOURCING_SEARCH_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type SourcingSearchStatus = (typeof SOURCING_SEARCH_STATUSES)[number]

export interface SourcingPriceTier {
  minimumQuantity: number
  maximumQuantity?: number | null
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
