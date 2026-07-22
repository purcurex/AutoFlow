import { isIP } from 'net'
import { lookup } from 'dns/promises'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { load } from 'cheerio'
import type {
  NormalizedContactEvidence,
  NormalizedShopifyStore,
} from './discovery.types'

@Injectable()
export class StorefrontEnrichmentService {
  private readonly logger = new Logger(StorefrontEnrichmentService.name)
  private readonly enabled: boolean
  private readonly timeoutMs: number

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('STOREFRONT_ENRICHMENT_ENABLED')
    const nodeEnv = configService.get<string>('NODE_ENV', 'development')
    this.enabled = configured === undefined ? nodeEnv === 'production' : configured === 'true'
    this.timeoutMs = Number(configService.get('STOREFRONT_ENRICHMENT_TIMEOUT_MS', 8_000))
  }

  async enrich(stores: NormalizedShopifyStore[]): Promise<NormalizedShopifyStore[]> {
    if (!this.enabled) return stores

    const enriched: NormalizedShopifyStore[] = []
    for (let index = 0; index < stores.length; index += 4) {
      const batch = stores.slice(index, index + 4)
      enriched.push(...await Promise.all(batch.map((store) => this.enrichStore(store))))
    }
    return enriched
  }

  private async enrichStore(store: NormalizedShopifyStore): Promise<NormalizedShopifyStore> {
    if (store.verificationStatus === 'mock') return store

    try {
      const storefrontUrl = await this.assertPublicStorefrontUrl(store.url)
      const response = await axios.get<string>(storefrontUrl, {
        timeout: this.timeoutMs,
        maxRedirects: 0,
        maxContentLength: 1_500_000,
        responseType: 'text',
        headers: { 'User-Agent': 'AutoFlow-StorefrontVerifier/1.0' },
        validateStatus: (status) => status >= 200 && status < 400,
      })
      const html = String(response.data || '').slice(0, 1_500_000)
      const shopifyMarkers = this.shopifyMarkers(html)
      const verified = shopifyMarkers.length >= 2 || store.normalizedDomain.endsWith('.myshopify.com')
      const contacts = this.mergeContacts(store.contacts, this.extractContacts(html, storefrontUrl))

      return {
        ...store,
        shopifyConfidence: verified ? Math.max(store.shopifyConfidence, 95) : Math.min(store.shopifyConfidence, 45),
        verificationStatus: verified ? 'verified' : 'unverified',
        verificationEvidence: {
          source: 'storefront_html',
          httpStatus: response.status,
          shopifyMarkers,
          contactCount: contacts.length,
        },
        verifiedAt: new Date().toISOString(),
        contacts,
      }
    } catch (error: unknown) {
      this.logger.warn(`Storefront verification failed for ${store.normalizedDomain}: ${this.errorMessage(error)}`)
      return {
        ...store,
        verificationStatus: 'failed',
        verificationEvidence: {
          ...store.verificationEvidence,
          verificationError: this.errorMessage(error),
        },
        verifiedAt: new Date().toISOString(),
      }
    }
  }

  private shopifyMarkers(html: string): string[] {
    const lower = html.toLowerCase()
    return [
      ['cdn.shopify.com', 'cdn_shopify'],
      ['shopify.theme', 'shopify_theme'],
      ['shopify-section', 'shopify_section'],
      ['myshopify.com', 'myshopify_domain'],
      ['shopify-payment-button', 'shopify_payment'],
    ].flatMap(([needle, marker]) => lower.includes(needle) ? [marker] : [])
  }

  private extractContacts(html: string, sourceUrl: string): NormalizedContactEvidence[] {
    const $ = load(html)
    const contacts: NormalizedContactEvidence[] = []
    const text = $('body').text().replace(/\s+/g, ' ')
    const emails = new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])

    for (const email of emails) {
      contacts.push(this.contact('email', email.toLowerCase(), sourceUrl, 'page_text', 75))
    }

    $('a[href]').each((_index, element) => {
      const href = String($(element).attr('href') || '').trim()
      if (!href) return
      const lower = href.toLowerCase()
      if (lower.startsWith('mailto:')) {
        const email = href.slice(7).split('?')[0].trim().toLowerCase()
        if (email) contacts.push(this.contact('email', email, sourceUrl, 'mailto_link', 90))
      } else if (lower.includes('wa.me/') || lower.includes('api.whatsapp.com/')) {
        contacts.push(this.contact('whatsapp', href, sourceUrl, 'social_link', 85))
      } else if (lower.includes('instagram.com/')) {
        contacts.push(this.contact('instagram', href, sourceUrl, 'social_link', 80))
      } else if (lower.includes('facebook.com/')) {
        contacts.push(this.contact('facebook', href, sourceUrl, 'social_link', 80))
      } else if (lower.includes('linkedin.com/')) {
        contacts.push(this.contact('linkedin', href, sourceUrl, 'social_link', 80))
      }
    })

    return this.mergeContacts([], contacts)
  }

  private contact(
    type: NormalizedContactEvidence['type'],
    value: string,
    sourceUrl: string,
    sourceType: string,
    confidence: number,
  ): NormalizedContactEvidence {
    return {
      type,
      value: value.slice(0, 500),
      label: null,
      sourceUrl,
      sourceType,
      verificationStatus: confidence >= 85 ? 'verified' : 'observed',
      confidence,
      evidence: { extractedFrom: sourceType },
    }
  }

  private mergeContacts(
    existing: NormalizedContactEvidence[],
    discovered: NormalizedContactEvidence[],
  ): NormalizedContactEvidence[] {
    const contacts = new Map<string, NormalizedContactEvidence>()
    for (const contact of [...existing, ...discovered]) {
      const key = `${contact.type}|${contact.value.toLowerCase()}`
      const previous = contacts.get(key)
      if (!previous || contact.confidence > previous.confidence) contacts.set(key, contact)
    }
    return [...contacts.values()]
  }

  private async assertPublicStorefrontUrl(value: string): Promise<string> {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('Only HTTPS storefronts can be verified')
    if (url.username || url.password) throw new Error('Credentialed storefront URLs are not allowed')
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('Private storefront host is not allowed')

    const addresses = await lookup(hostname, { all: true })
    if (addresses.length === 0 || addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new Error('Private storefront address is not allowed')
    }
    return url.toString()
  }

  private isPrivateAddress(address: string): boolean {
    if (isIP(address) === 4) {
      const [a, b] = address.split('.').map(Number)
      return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    }
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe80:') || normalized.startsWith('::ffff:127.')
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown verification error')
  }
}
