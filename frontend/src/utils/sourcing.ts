import { currencyCode } from './currency'
import {
  autoflowApi,
  type SourcingOffer,
  type SourcingSearch,
  type SourcingSearchStatus,
  type SourcingSummary,
} from '@/api/autoflow'

export type {
  SourcingOffer,
  SourcingSearch,
  SourcingSearchStatus,
  SourcingSummary,
} from '@/api/autoflow'

export const sourcingApi = autoflowApi

export function currentSourcingSearch(summary: SourcingSummary | null): SourcingSearch | null {
  return summary?.latestSearch ?? summary?.search ?? null
}

export function sourcingStatus(summary: SourcingSummary | null): SourcingSearchStatus {
  if (!summary?.providerConfigured) return 'not_configured'
  return currentSourcingSearch(summary)?.status ?? summary.status ?? 'idle'
}

export function isSourcingRunning(summary: SourcingSummary | null): boolean {
  return sourcingStatus(summary) === 'running'
}

export function sourcingStatusClass(status: SourcingSearchStatus): string {
  return {
    not_configured: 'status-warning',
    idle: 'status-neutral',
    running: 'status-info',
    failed: 'status-danger',
    completed: 'status-success',
  }[status]
}

export function offerPrimaryTitle(offer: SourcingOffer): string | null {
  return offer.chineseTitle || offer.title || offer.foreignTitle || null
}

export function offerSecondaryTitle(offer: SourcingOffer): string | null {
  const primary = offerPrimaryTitle(offer)
  const candidates = [offer.foreignTitle, offer.chineseTitle, offer.title]
  return candidates.find((candidate) => candidate && candidate !== primary) ?? null
}

export function offerPriceParts(offer: SourcingOffer): {
  currency: string
  minimum: string | null
  maximum: string | null
} {
  const minimum = displayNumber(offer.priceMin ?? offer.price)
  const maximum = displayNumber(offer.priceMax)
  return {
    currency: currencyCode(offer.currency),
    minimum,
    maximum: maximum === minimum ? null : maximum,
  }
}

export function displayNumber(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(numeric)
}

export function displayPercent(value: number | string | null | undefined): string | null {
  const normalized = displayNumber(value)
  if (!normalized) return null
  return `${normalized}%`
}

export function offerSupplierName(offer: SourcingOffer): string | null {
  return offer.supplier?.companyName
    || offer.supplierCompanyName
    || offer.supplier?.shopName
    || null
}

export function offerSupplierScore(offer: SourcingOffer): string | null {
  return displayNumber(offer.supplier?.score ?? offer.supplierScore)
}

export function offerSupplierIdentities(offer: SourcingOffer): string[] {
  return Array.from(new Set([
    ...(offer.supplier?.identities ?? []),
    ...(offer.supplier?.badges ?? []),
    ...(offer.supplierIdentities ?? []),
  ].filter(Boolean)))
}

export function offerReasons(offer: SourcingOffer): string[] {
  return offer.recommendationReasons?.length
    ? offer.recommendationReasons
    : offer.scoreReasons ?? []
}

export function offerShopUrl(offer: SourcingOffer): string | null {
  return safeExternalUrl(offer.supplier?.shopUrl ?? offer.supplierShopUrl)
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
