import axios from 'axios'
import { lookup } from 'dns/promises'
import type { ConfigService } from '@nestjs/config'
import type { NormalizedShopifyStore } from './discovery.types'
import { StorefrontEnrichmentService } from './storefront-enrichment.service'

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    isAxiosError: (error: unknown) => Boolean(
      error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError,
    ),
  },
}))
jest.mock('dns/promises', () => ({ lookup: jest.fn() }))

const axiosGet = axios.get as jest.Mock
const dnsLookup = lookup as jest.Mock

describe('StorefrontEnrichmentService', () => {
  const store: NormalizedShopifyStore = {
    name: 'PawSpark',
    domain: 'pawspark.example',
    normalizedDomain: 'pawspark.example',
    url: 'https://pawspark.example',
    productUrl: 'https://pawspark.example/products/pet-brush',
    description: 'Pet products',
    imageUrl: null,
    detectionSource: 'shopify_search',
    discoverySources: ['google_search'],
    validityScore: 75,
    shopifyConfidence: 65,
    verificationStatus: 'unverified',
    verificationEvidence: {},
    verifiedAt: null,
    contacts: [],
    traffic: null,
    rawPayload: {},
  }

  function service(enabled: boolean) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'STOREFRONT_ENRICHMENT_ENABLED') return String(enabled)
        return fallback
      }),
    }
    return new StorefrontEnrichmentService(config as unknown as ConfigService)
  }

  beforeEach(() => jest.clearAllMocks())

  it('verifies Shopify HTML and extracts evidence-backed contacts', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    axiosGet.mockResolvedValue({
      status: 200,
      data: '<html><body class="shopify-section"><script src="https://cdn.shopify.com/theme.js"></script><a href="mailto:sales@pawspark.example">Email</a><a href="https://wa.me/15551234567">WhatsApp</a></body></html>',
    })

    const [result] = await service(true).enrich([store])

    expect(result.verificationStatus).toBe('verified')
    expect(result.shopifyConfidence).toBe(95)
    expect(result.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'email',
        value: 'sales@pawspark.example',
        verificationStatus: 'verified',
        sourceType: 'storefront_mailto_link',
        evidence: expect.objectContaining({ proves: 'email', sourcePageKind: 'storefront' }),
      }),
      expect.objectContaining({ type: 'whatsapp', verificationStatus: 'verified' }),
    ]))
  })

  it('crawls high-value same-origin pages and classifies contact evidence', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: '<html><head><title>PawSpark Store</title></head><body class="shopify-section"><script src="https://cdn.shopify.com/theme.js"></script><a href="/pages/contact-us">Contact Us</a><a href="https://facebook.com/sharer.php?u=x">Share</a><a href="https://instagram.com/p/promo">Post</a></body></html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '<html><head><title>Contact PawSpark</title></head><body><a href="mailto:hello@pawspark.example">Email Sales</a><a href="tel:+1 (555) 123-4567">Call Us</a><a href="https://api.whatsapp.com/send?phone=15557654321">WhatsApp</a><script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.facebook.com/pawspark/","https://www.instagram.com/pawspark/"]}</script></body></html>',
      })

    const [result] = await service(true).enrich([store])

    expect(result.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'email',
        value: 'hello@pawspark.example',
        sourceUrl: 'https://pawspark.example/pages/contact-us',
        evidence: expect.objectContaining({
          sourcePageTitle: 'Contact PawSpark',
          sourcePageKind: 'contact',
          proves: 'email',
        }),
      }),
      expect.objectContaining({ type: 'phone', value: '+15551234567' }),
      expect.objectContaining({ type: 'whatsapp', value: 'https://wa.me/15557654321' }),
      expect.objectContaining({ type: 'facebook', value: 'https://facebook.com/pawspark' }),
      expect.objectContaining({ type: 'instagram', value: 'https://instagram.com/pawspark' }),
    ]))
    expect(result.contacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: expect.stringContaining('sharer.php') }),
      expect.objectContaining({ value: expect.stringContaining('/p/promo') }),
    ]))
    expect(result.verificationEvidence).toEqual(expect.objectContaining({
      analyzedPages: expect.arrayContaining([
        expect.objectContaining({ kind: 'storefront', title: 'PawSpark Store' }),
        expect.objectContaining({ kind: 'contact', title: 'Contact PawSpark' }),
      ]),
    }))
  })

  it.each<NormalizedShopifyStore['verificationStatus']>(['probable', 'unverified'])(
    'preserves %s storefront evidence when verification is rate limited',
    async (verificationStatus) => {
      dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
      axiosGet.mockRejectedValue(Object.assign(new Error('Request failed with status code 429'), {
        isAxiosError: true,
        response: { status: 429 },
      }))

      const [result] = await service(true).enrich([{ ...store, verificationStatus }])

      expect(result.verificationStatus).toBe(verificationStatus)
      expect(result.verificationEvidence).toEqual(expect.objectContaining({
        verificationBlocked: true,
        verificationHttpStatus: 429,
        verificationError: 'Request failed with status code 429',
      }))
      expect(result.verifiedAt).not.toBeNull()
    },
  )

  it('rejects private storefront targets without making an HTTP request', async () => {
    const [result] = await service(true).enrich([{ ...store, url: 'https://localhost' }])

    expect(result.verificationStatus).toBe('failed')
    expect(axiosGet).not.toHaveBeenCalled()
  })
})
