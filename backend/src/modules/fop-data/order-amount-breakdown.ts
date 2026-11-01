import type { FopOrderAmountBreakdown } from './fop-data.types'

/** Whitelist stored amounts; zero is known, missing/invalid values stay unknown. */
export function normalizeOrderAmountBreakdown(value: unknown): FopOrderAmountBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const amount = (key: string) => {
    const number = fields[key]
    return typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER / 100 ? number : null
  }
  return { productAmount: amount('productAmount'), shippingFee: amount('shippingFee'), taxAmount: amount('taxAmount'), discountAmount: amount('discountAmount') }
}
