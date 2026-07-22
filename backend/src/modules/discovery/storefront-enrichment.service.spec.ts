import axios from 'axios'
import { lookup } from 'dns/promises'
import type { ConfigService } from '@nestjs/config'
import type { NormalizedShopifyStore } from './discovery.types'
import { StorefrontEnrichmentService } from './storefront-enrichment.service'

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
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
    description: 'Pet products',
    imageUrl: null,
    detectionSource: 'shopify_search',
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
      expect.objectContaining({ type: 'email', value: 'sales@pawspark.example', verificationStatus: 'verified' }),
      expect.objectContaining({ type: 'whatsapp', verificationStatus: 'verified' }),
    ]))
  })

  it('rejects private storefront targets without making an HTTP request', async () => {
    const [result] = await service(true).enrich([{ ...store, url: 'https://localhost' }])

    expect(result.verificationStatus).toBe('failed')
    expect(axiosGet).not.toHaveBeenCalled()
  })
})
