import { Decimal } from 'decimal.js'

export interface SourcingScoreInput {
  query: string
  title: string
  providerRank?: number | null
  priceRanges?: Array<{
    minimumQuantity?: string | null
    price?: string | null
  }>
  targetPriceMin?: string | null
  targetPriceMax?: string | null
  minimumOrderQuantity?: string | null
  sellerCompositeScore?: number | null
  sellerTradeScore?: number | null
  sellerYears?: number | null
  repeatPurchasePercent?: number | null
  deliveryReadinessPercent?: number | null
  supportsCustomization?: boolean
  isVerifiedSupplier?: boolean
}

export interface SourcingScoreBreakdown {
  relevance: number
  pricing: number
  minimumOrderQuantity: number
  supplierReliability: number
  delivery: number
  capabilities: number
}

export interface SourcingScoreResult {
  score: number
  dimensions: SourcingScoreBreakdown
  reasons: string[]
}

const MAXIMUMS: SourcingScoreBreakdown = {
  relevance: 35,
  pricing: 20,
  minimumOrderQuantity: 15,
  supplierReliability: 15,
  delivery: 10,
  capabilities: 5,
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function normalizePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return clamp(value > 1 ? value / 100 : value, 0, 1)
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[\s,.;:()[\]{}<>/\\|_-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  )
}

function scoreRelevance(input: SourcingScoreInput): number {
  const queryTokens = tokenize(input.query)
  const titleTokens = tokenize(input.title)
  if (queryTokens.size > 0) {
    const matched = [...queryTokens].filter((token) =>
      [...titleTokens].some((titleToken) => titleToken.includes(token) || token.includes(titleToken)),
    ).length
    if (matched > 0) return round(MAXIMUMS.relevance * (matched / queryTokens.size))
  }

  const rank = input.providerRank
  if (rank === null || rank === undefined || rank <= 0) return 0
  return round(MAXIMUMS.relevance * clamp(1 - (rank - 1) / 50, 0.2, 1))
}

function scorePricing(input: SourcingScoreInput): number {
  const prices = (input.priceRanges || [])
    .map((range) => range.price)
    .filter((price): price is string => typeof price === 'string')
    .map((price) => {
      try { return new Decimal(price) } catch { return null }
    })
    .filter((price): price is Decimal => Boolean(price?.isFinite() && !price.isNegative()))
  if (prices.length === 0) return 0

  const minimumPrice = prices.reduce((current, price) => Decimal.min(current, price))
  const targetMin = input.targetPriceMin
  const targetMax = input.targetPriceMax
  if (targetMin === null || targetMin === undefined || targetMax === null || targetMax === undefined) {
    return prices.length > 1 ? 16 : 12
  }
  const minimumTarget = new Decimal(targetMin)
  const maximumTarget = new Decimal(targetMax)
  if (minimumPrice.greaterThanOrEqualTo(minimumTarget) && minimumPrice.lessThanOrEqualTo(maximumTarget)) {
    return MAXIMUMS.pricing
  }

  const distance = minimumPrice.lessThan(minimumTarget)
    ? minimumTarget.minus(minimumPrice).dividedBy(Decimal.max(minimumTarget, 1))
    : minimumPrice.minus(maximumTarget).dividedBy(Decimal.max(maximumTarget, 1))
  return round(MAXIMUMS.pricing * clamp(1 - distance.toNumber(), 0, 0.75))
}

function scoreMinimumOrderQuantity(quantity: string | null | undefined): number {
  if (quantity === null || quantity === undefined) return 0
  let decimal: Decimal
  try { decimal = new Decimal(quantity) } catch { return 0 }
  if (!decimal.isFinite() || decimal.lessThanOrEqualTo(0)) return 0
  if (decimal.lessThanOrEqualTo(1)) return MAXIMUMS.minimumOrderQuantity
  if (decimal.lessThanOrEqualTo(5)) return 13
  if (decimal.lessThanOrEqualTo(20)) return 10
  if (decimal.lessThanOrEqualTo(100)) return 6
  return 2
}

function scoreSupplierReliability(input: SourcingScoreInput): number {
  const normalizedComposite = normalizePercent(input.sellerCompositeScore)
  const normalizedTrade = normalizePercent(input.sellerTradeScore)
  const normalizedRepeat = normalizePercent(input.repeatPurchasePercent)
  const signals = [normalizedComposite, normalizedTrade, normalizedRepeat].filter(
    (value): value is number => value !== null,
  )
  const signalScore = signals.length > 0
    ? signals.reduce((sum, value) => sum + value, 0) / signals.length
    : 0
  const tenureBonus = input.sellerYears ? clamp(input.sellerYears / 8, 0, 1) * 0.15 : 0
  const verifiedBonus = input.isVerifiedSupplier ? 0.15 : 0
  return round(MAXIMUMS.supplierReliability * clamp(signalScore * 0.7 + tenureBonus + verifiedBonus, 0, 1))
}

function scoreDelivery(value: number | null | undefined): number {
  const normalized = normalizePercent(value)
  return normalized === null ? 0 : round(MAXIMUMS.delivery * normalized)
}

export function calculateSourcingScore(input: SourcingScoreInput): SourcingScoreResult {
  const dimensions: SourcingScoreBreakdown = {
    relevance: scoreRelevance(input),
    pricing: scorePricing(input),
    minimumOrderQuantity: scoreMinimumOrderQuantity(input.minimumOrderQuantity),
    supplierReliability: scoreSupplierReliability(input),
    delivery: scoreDelivery(input.deliveryReadinessPercent),
    capabilities: input.supportsCustomization ? MAXIMUMS.capabilities : 0,
  }
  const score = Math.round(
    Object.values(dimensions).reduce((total, dimension) => total + dimension, 0),
  )
  const reasons: string[] = []

  if (dimensions.relevance >= 25) reasons.push('high_product_relevance')
  if (dimensions.pricing >= 16) reasons.push('usable_price_range')
  if (dimensions.minimumOrderQuantity >= 10) reasons.push('dropshipping_friendly_moq')
  if (dimensions.supplierReliability >= 10) reasons.push('reliable_supplier_signals')
  if (dimensions.delivery >= 7) reasons.push('fast_dispatch_signal')
  if (dimensions.capabilities > 0) reasons.push('customization_supported')

  return { score, dimensions, reasons }
}
