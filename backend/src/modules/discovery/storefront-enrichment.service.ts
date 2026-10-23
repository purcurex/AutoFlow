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

interface StorefrontPage {
  url: string
  html: string
  title: string | null
  kind: 'storefront' | 'contact' | 'about' | 'support' | 'policy'
}

@Injectable()
export class StorefrontEnrichmentService {
  private readonly logger = new Logger(StorefrontEnrichmentService.name)
  private readonly enabled: boolean
  private readonly timeoutMs: number

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('STOREFRONT_ENRICHMENT_ENABLED')
    const nodeEnv = configService.get<string>('NODE_ENV', 'development')
    this.enabled = configured === undefined ? nodeEnv !== 'test' : configured === 'true'
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

  async enrichStore(store: NormalizedShopifyStore): Promise<NormalizedShopifyStore> {
    if (store.verificationStatus === 'mock') return store

    try {
      const storefrontUrl = await this.assertPublicStorefrontUrl(store.url)
      const storefront = await this.fetchPage(storefrontUrl, 'storefront')
      const evidencePages = await this.fetchEvidencePages(storefront)
      const shopifyMarkers = this.shopifyMarkers(storefront.html)
      const verified = shopifyMarkers.length >= 2 || store.normalizedDomain.endsWith('.myshopify.com')
      const extractedContacts = evidencePages.flatMap((page) => this.extractContacts(page))
      const contacts = this.mergeContacts(
        store.contacts.filter((contact) => contact.type !== 'website'),
        extractedContacts,
      )

      return {
        ...store,
        shopifyConfidence: verified ? Math.max(store.shopifyConfidence, 95) : Math.min(store.shopifyConfidence, 45),
        validityScore: verified ? Math.min(100, store.validityScore + 15) : Math.min(store.validityScore, 45),
        verificationStatus: verified ? 'verified' : 'unverified',
        verificationEvidence: {
          ...store.verificationEvidence,
          source: 'storefront_html',
          shopifyMarkers,
          contactCount: contacts.length,
          analyzedPages: evidencePages.map((page) => ({
            url: page.url,
            title: page.title,
            kind: page.kind,
          })),
        },
        verifiedAt: new Date().toISOString(),
        contacts,
      }
    } catch (error: unknown) {
      const verificationError = this.errorMessage(error)
      const verificationHttpStatus = this.httpStatus(error)

      // 需求：目标店铺返回 429 仅表示自动验证受限，不能覆盖候选已有的可信状态。
      if (verificationHttpStatus === 429) {
        this.logger.warn(`Storefront verification rate limited for ${store.normalizedDomain}: ${verificationError}`)
        return {
          ...store,
          verificationEvidence: {
            ...store.verificationEvidence,
            verificationBlocked: true,
            verificationHttpStatus,
            verificationError,
          },
          verifiedAt: new Date().toISOString(),
        }
      }

      this.logger.warn(`Storefront verification failed for ${store.normalizedDomain}: ${verificationError}`)
      return {
        ...store,
        verificationStatus: 'failed',
        verificationEvidence: {
          ...store.verificationEvidence,
          verificationError,
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

  private async fetchPage(url: string, kind: StorefrontPage['kind']): Promise<StorefrontPage> {
    let currentUrl = url
    for (let redirect = 0; redirect <= 2; redirect += 1) {
      currentUrl = await this.assertPublicStorefrontUrl(currentUrl)
      const response = await axios.get<string>(currentUrl, {
        timeout: this.timeoutMs,
        maxRedirects: 0,
        maxContentLength: 1_500_000,
        responseType: 'text',
        headers: { 'User-Agent': 'AutoFlow-StorefrontAnalyzer/2.0' },
        validateStatus: (status) => status >= 200 && status < 400,
      })
      if (response.status >= 300) {
        const location = response.headers?.location
        if (!location || redirect === 2) throw new Error('Storefront redirect could not be resolved safely')
        currentUrl = new URL(String(location), currentUrl).toString()
        continue
      }
      const html = String(response.data || '').slice(0, 1_500_000)
      const $ = load(html)
      const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 200) || null
      return { url: currentUrl, html, title, kind }
    }
    throw new Error('Storefront redirect limit exceeded')
  }

  private async fetchEvidencePages(storefront: StorefrontPage): Promise<StorefrontPage[]> {
    const candidates = this.evidencePageCandidates(storefront)
    const settled = await Promise.allSettled(candidates.map(async (candidate) => {
      await this.assertPublicStorefrontUrl(candidate.url)
      return this.fetchPage(candidate.url, candidate.kind)
    }))
    return [
      storefront,
      ...settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
    ]
  }

  private evidencePageCandidates(storefront: StorefrontPage) {
    const $ = load(storefront.html)
    const origin = new URL(storefront.url).origin
    const pages = new Map<string, { url: string; kind: Exclude<StorefrontPage['kind'], 'storefront'>; score: number }>()
    $('a[href]').each((_index, element) => {
      const href = String($(element).attr('href') || '').trim()
      const text = $(element).text().replace(/\s+/g, ' ').trim().toLowerCase()
      if (!href) return
      let url: URL
      try {
        url = new URL(href, storefront.url)
      } catch {
        return
      }
      if (url.origin !== origin || url.protocol !== 'https:') return
      url.hash = ''
      url.search = ''
      const basis = `${url.pathname} ${text}`.toLowerCase()
      const match = ([
        { pattern: /(contact|contact-us|contact_information|联系我们|联系)/, kind: 'contact', score: 100 },
        { pattern: /(support|help|customer-service|客服|帮助)/, kind: 'support', score: 80 },
        { pattern: /(about|about-us|our-story|关于)/, kind: 'about', score: 60 },
        { pattern: /(privacy|terms|legal|imprint|policy)/, kind: 'policy', score: 40 },
      ] as const).find((item) => item.pattern.test(basis))
      if (!match) return
      const normalized = url.toString()
      const previous = pages.get(normalized)
      if (!previous || match.score > previous.score) {
        pages.set(normalized, { url: normalized, kind: match.kind, score: match.score })
      }
    })
    return [...pages.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map(({ url, kind }) => ({ url, kind }))
  }

  private extractContacts(page: StorefrontPage): NormalizedContactEvidence[] {
    const $ = load(page.html)
    const contacts: NormalizedContactEvidence[] = []
    const text = $('body').text().replace(/\s+/g, ' ')
    const emails = new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])

    for (const email of emails) {
      contacts.push(this.contact('email', email.toLowerCase(), page, 'page_text', 75))
    }

    $('a[href]').each((_index, element) => {
      const href = String($(element).attr('href') || '').trim()
      const anchorText = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 160) || null
      if (!href) return
      const lower = href.toLowerCase()
      if (lower.startsWith('mailto:')) {
        const email = href.slice(7).split('?')[0].trim().toLowerCase()
        if (email) contacts.push(this.contact('email', email, page, 'mailto_link', 95, anchorText))
      } else if (lower.startsWith('tel:')) {
        const phone = this.normalizePhone(href.slice(4))
        if (phone) contacts.push(this.contact('phone', phone, page, 'telephone_link', 95, anchorText))
      } else if (lower.includes('wa.me/') || lower.includes('api.whatsapp.com/')) {
        const value = this.normalizeContactUrl(href, page.url, 'whatsapp')
        if (value) contacts.push(this.contact('whatsapp', value, page, 'whatsapp_link', 95, anchorText))
      } else if (lower.includes('instagram.com/')) {
        const value = this.normalizeContactUrl(href, page.url, 'instagram')
        if (value) contacts.push(this.contact('instagram', value, page, 'social_profile_link', 85, anchorText))
      } else if (lower.includes('facebook.com/')) {
        const value = this.normalizeContactUrl(href, page.url, 'facebook')
        if (value) contacts.push(this.contact('facebook', value, page, 'social_profile_link', 85, anchorText))
      } else if (lower.includes('linkedin.com/')) {
        const value = this.normalizeContactUrl(href, page.url, 'linkedin')
        if (value) contacts.push(this.contact('linkedin', value, page, 'social_profile_link', 85, anchorText))
      }
    })

    const labelledPhones = text.matchAll(
      /(?:phone|telephone|tel|call us|联系电话|电话)\s*[:：]?\s*(\+?[0-9][0-9\s().-]{6,}[0-9])/gi,
    )
    for (const match of labelledPhones) {
      const phone = this.normalizePhone(match[1])
      if (phone) contacts.push(this.contact('phone', phone, page, 'labelled_page_text', 75))
    }
    const labelledWhatsApp = text.matchAll(
      /(?:whatsapp|whats app|wa)\s*[:：]?\s*(\+?[0-9][0-9\s().-]{6,}[0-9])/gi,
    )
    for (const match of labelledWhatsApp) {
      const phone = this.normalizePhone(match[1])
      if (phone) {
        contacts.push(this.contact(
          'whatsapp',
          `https://wa.me/${phone.replace(/\D/g, '')}`,
          page,
          'labelled_page_text',
          80,
        ))
      }
    }

    $('script[type="application/ld+json"]').each((_index, element) => {
      try {
        const value = JSON.parse($(element).text()) as unknown
        this.extractStructuredContacts(value, page, contacts)
      } catch {
        // Invalid merchant JSON-LD is ignored without failing the page analysis.
      }
    })

    return this.mergeContacts([], contacts)
  }

  private contact(
    type: NormalizedContactEvidence['type'],
    value: string,
    page: StorefrontPage,
    sourceType: string,
    confidence: number,
    anchorText: string | null = null,
  ): NormalizedContactEvidence {
    const labels: Partial<Record<NormalizedContactEvidence['type'], string>> = {
      email: 'Email Address',
      phone: 'Phone Number',
      whatsapp: 'WhatsApp Account',
      facebook: 'Facebook Profile',
      instagram: 'Instagram Profile',
      linkedin: 'LinkedIn Profile',
    }
    return {
      type,
      value: value.slice(0, 500),
      label: labels[type] || null,
      sourceUrl: page.url,
      sourceType: `storefront_${sourceType}`,
      verificationStatus: confidence >= 85 ? 'verified' : 'observed',
      confidence,
      evidence: {
        extractedFrom: sourceType,
        sourcePageTitle: page.title,
        sourcePageKind: page.kind,
        anchorText,
        proves: type,
      },
    }
  }

  private extractStructuredContacts(
    value: unknown,
    page: StorefrontPage,
    contacts: NormalizedContactEvidence[],
  ) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.extractStructuredContacts(item, page, contacts))
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.email === 'string' && record.email.includes('@')) {
      contacts.push(this.contact('email', record.email.toLowerCase(), page, 'structured_data', 90))
    }
    if (typeof record.telephone === 'string') {
      const phone = this.normalizePhone(record.telephone)
      if (phone) contacts.push(this.contact('phone', phone, page, 'structured_data', 90))
    }
    if (Array.isArray(record.sameAs)) {
      for (const candidate of record.sameAs) {
        if (typeof candidate !== 'string') continue
        for (const type of ['facebook', 'instagram', 'linkedin'] as const) {
          if (!candidate.toLowerCase().includes(`${type}.com/`)) continue
          const normalized = this.normalizeContactUrl(candidate, page.url, type)
          if (normalized) contacts.push(this.contact(type, normalized, page, 'structured_data', 90))
        }
      }
    }
    Object.values(record).forEach((child) => {
      if (child && typeof child === 'object') this.extractStructuredContacts(child, page, contacts)
    })
  }

  private normalizePhone(value: string): string | null {
    const trimmed = value.trim()
    const hasPlus = trimmed.startsWith('+')
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) return null
    return `${hasPlus ? '+' : ''}${digits}`
  }

  private normalizeContactUrl(
    value: string,
    baseUrl: string,
    type: 'whatsapp' | 'facebook' | 'instagram' | 'linkedin',
  ): string | null {
    let url: URL
    try {
      url = new URL(value, baseUrl)
    } catch {
      return null
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (type === 'whatsapp') {
      if (host === 'wa.me') {
        const phone = this.normalizePhone(path)
        return phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : null
      }
      const phone = this.normalizePhone(url.searchParams.get('phone') || '')
      return phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : null
    }
    if (type === 'facebook' && (
      /\/(sharer|share|dialog|plugins|tr)(\/|\.php|$)/i.test(path)
      || url.searchParams.has('u')
    )) return null
    if (type === 'instagram' && /^\/(p|reel|stories|explore)\//i.test(path)) return null
    if (type === 'linkedin' && !/^\/(company|in)\//i.test(path)) return null
    url.protocol = 'https:'
    url.hostname = host
    url.pathname = path
    url.search = ''
    url.hash = ''
    return url.toString()
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
    const priority = { phone: 0, whatsapp: 1, facebook: 2, email: 3, instagram: 4, linkedin: 5, other: 6, website: 9 }
    return [...contacts.values()].sort((left, right) => (
      (priority[left.type] ?? 9) - (priority[right.type] ?? 9)
      || right.confidence - left.confidence
    ))
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

  /** 提取结构化 HTTP 状态，避免依赖可能变化的异常消息文本。 */
  private httpStatus(error: unknown): number | null {
    return axios.isAxiosError(error) && typeof error.response?.status === 'number'
      ? error.response.status
      : null
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown verification error')
  }
}
