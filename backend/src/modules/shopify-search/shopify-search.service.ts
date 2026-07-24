import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import {
  DEFAULT_GOOGLE_SEARCH_OPTIONS,
  type DiscoverySource,
  type GoogleSearchOptions,
} from '../autoflow/autoflow.types'

export interface DomainTraffic {
  monthlyVisits?: number
  rank?: number
  bounceRate?: number
  avgVisitDuration?: number
  pagesPerVisit?: number
  source: string
}

export interface ShopifyStore {
  name: string
  url: string
  productUrl: string | null
  description?: string
  imageUrl?: string
  traffic?: DomainTraffic
  source: DiscoverySource
  validityScore: number
  searchPosition: number | null
}

@Injectable()
export class ShopifySearchService {
  private readonly logger = new Logger(ShopifySearchService.name)
  private readonly dailyLimit: number
  private readonly searchCount = new Map<string, number>()

  constructor(private readonly configService: ConfigService) {
    this.dailyLimit = this.configService.get<number>('DAILY_SEARCH_LIMIT', 250)
  }

  getSearchCountInfo(): { current: number; remaining: number; limit: number } {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    return {
      current,
      remaining: Math.max(0, this.dailyLimit - current),
      limit: this.dailyLimit,
    }
  }

  async searchStoresByImageFile(_filePath: string): Promise<ShopifyStore[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()
    return this.fallbackToMockResults('Image file search is not wired to a production provider yet')
  }

  isGoogleLensConfigured(): boolean {
    return Boolean(this.getSerpApiKey())
  }

  async searchStoresByImageUrl(imageUrl: string, targetMarket?: string): Promise<ShopifyStore[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured')
    }

    return this.searchStoresByGoogleLens(imageUrl, targetMarket)
  }

  async searchStoresByKeyword(
    keyword: string,
    targetMarket?: string,
    options: GoogleSearchOptions = DEFAULT_GOOGLE_SEARCH_OPTIONS,
  ): Promise<ShopifyStore[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured')
    }

    return this.searchStoresByQuery(
      this.buildShopifyProductQuery(keyword, options),
      targetMarket,
    )
  }

  buildShopifyProductQuery(keyword: string, options: GoogleSearchOptions): string {
    const normalized = keyword.trim().replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ')
    const term = options.titleMatch
      ? `intitle:"${normalized}"`
      : options.exactPhrase ? `"${normalized}"` : normalized
    const exclusions = options.excludeMarketplaces
      ? ' -site:amazon.com -site:ebay.com -site:walmart.com -site:aliexpress.com -site:temu.com'
      : ''
    return `${term} inurl:/products/ "Powered by Shopify"${exclusions}`
  }

  async findOwnerFacebookProfile(
    storeName: string,
    domain: string,
    targetMarket?: string,
  ): Promise<string | null> {
    if (!this.getSerpApiKey()) return null
    this.assertSearchAllowed()
    this.incrementSearchCount()
    const identity = storeName.trim().replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ')
    try {
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: `site:facebook.com "${identity}" (owner OR founder) "${domain}"`,
          api_key: this.getSerpApiKey(),
          num: 5,
          hl: 'en',
          ...(this.countryCode(targetMarket) ? { gl: this.countryCode(targetMarket) } : {}),
        },
        timeout: 30000,
      })
      const results = Array.isArray(response.data?.organic_results) ? response.data.organic_results : []
      return results.map((item: Record<string, unknown>) => String(item.link || ''))
        .find((link: string) => this.isFacebookProfileUrl(link)) || null
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Facebook owner lookup failed for ${domain}: ${message}`)
      return null
    }
  }

  formatResultsAsNoteContent(
    stores: ShopifyStore[],
    _searchType: string = 'search',
    imageUrl?: string,
    keyword?: string,
    searchCountInfo?: { current: number; remaining: number; limit: number },
  ): string {
    const source = imageUrl || keyword || 'AutoFlow search'
    const rows = stores
      .map((store, index) => {
        const traffic = store.traffic?.monthlyVisits ? `Traffic: ${store.traffic.monthlyVisits}` : ''
        return `<p><strong>${index + 1}. ${this.escapeHtml(store.name)}</strong></p><p><a href="${this.escapeHtml(store.url)}" target="_blank">${this.escapeHtml(store.url)}</a></p><p>${this.escapeHtml(store.description || '')}</p><p>${traffic}</p>`
      })
      .join('')

    const quota = searchCountInfo
      ? `<p><em>Search usage: ${searchCountInfo.current}/${searchCountInfo.limit}, remaining ${searchCountInfo.remaining}</em></p>`
      : ''

    return `<h2>Shopify store search results</h2><p>Source: ${this.escapeHtml(source)}</p><p>Total stores: ${stores.length}</p>${rows}<hr>${quota}`
  }

  generateNoteTitle(searchType?: string, keyword?: string): string {
    const dateTime = new Date().toLocaleString('zh-CN')
    if (keyword) {
      return `Shopify leads - ${keyword} - ${dateTime}`
    }
    return `Shopify leads - ${searchType || 'search'} - ${dateTime}`
  }

  private async searchStoresByQuery(query: string, targetMarket?: string): Promise<ShopifyStore[]> {
    try {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: query,
          api_key: this.getSerpApiKey(),
          num: 20,
          hl: 'en',
          ...(this.countryCode(targetMarket) ? { gl: this.countryCode(targetMarket) } : {}),
        },
        timeout: 30000,
      })

      const results = response.data?.organic_results || []
      const stores = this.extractStores(results, 'google_search')
      if (stores.length === 0) {
        return this.fallbackToMockResults('No Shopify stores were found')
      }
      return stores
    } catch (error: any) {
      this.logger.error(`Shopify search failed: ${error.message}`)
      return this.fallbackToMockResults('Shopify search provider failed')
    }
  }

  private async searchStoresByGoogleLens(imageUrl: string, targetMarket?: string): Promise<ShopifyStore[]> {
    try {
      const url = new URL(imageUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported image URL protocol')
    } catch {
      throw new BadRequestException('Google Lens requires a public HTTP(S) image URL.')
    }

    try {
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_lens',
          type: 'visual_matches',
          url: imageUrl,
          q: 'Shopify product',
          auto_crop: true,
          api_key: this.getSerpApiKey(),
          hl: 'en',
          safe: 'active',
          ...(this.countryCode(targetMarket) ? { country: this.countryCode(targetMarket) } : {}),
        },
        timeout: 30000,
      })
      if (response.data?.error) throw new Error(String(response.data.error))

      const matches = Array.isArray(response.data?.visual_matches)
        ? response.data.visual_matches
        : []
      return this.extractStores(matches, 'google_lens')
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error
      const message = error instanceof Error ? error.message : 'Unknown Google Lens error'
      this.logger.error(`Google Lens search failed: ${message}`)
      throw new ServiceUnavailableException(`Google Lens search failed: ${message}`)
    }
  }

  private extractStores(items: any[], source: DiscoverySource): ShopifyStore[] {
    const seen = new Set<string>()
    const stores: ShopifyStore[] = []

    for (const item of items) {
      const link = item.link || item.url
      if (!link) continue

      try {
        const url = new URL(link)
        const hostname = url.hostname.replace(/^www\./, '')
        if (this.isMarketplaceHost(hostname)) continue
        const productUrl = this.productDetailUrl(url)
        const looksLikeStore = Boolean(productUrl)

        if (!looksLikeStore || seen.has(hostname)) continue
        seen.add(hostname)

        stores.push({
          name: source === 'google_lens' && item.source
            ? this.cleanStoreName(String(item.source), hostname)
            : this.storeNameFromHostname(hostname),
          url: url.origin,
          productUrl,
          description: item.snippet || '',
          imageUrl: item.image || item.thumbnail,
          traffic: { source: `serpapi_${source}` },
          source,
          validityScore: this.searchValidityScore(item, url, source),
          searchPosition: typeof item.position === 'number' ? item.position : null,
        })
      } catch {
        continue
      }
    }

    return stores.sort((left, right) => right.validityScore - left.validityScore).slice(0, 20)
  }

  private productDetailUrl(url: URL): string | null {
    if (!/\/products\/[^/?#]+/i.test(url.pathname)) return null
    url.hash = ''
    return url.toString()
  }

  private searchValidityScore(item: Record<string, unknown>, url: URL, source: DiscoverySource): number {
    const text = `${String(item.title || '')} ${String(item.snippet || '')}`.toLowerCase()
    const position = typeof item.position === 'number' ? item.position : 20
    let score = source === 'google_lens'
      ? Math.max(0, 45 - position * 4)
      : Math.max(5, 30 - position)
    if (this.productDetailUrl(url)) score += 35
    if (url.hostname.endsWith('myshopify.com')) score += 15
    if (text.includes('shopify') || text.includes('powered by')) score += 15
    if (source === 'google_lens' && item.exact_matches === true) score += 25
    if (typeof item.rating === 'number' || typeof item.reviews === 'number' || typeof item.in_stock === 'boolean') score += 5
    return Math.min(100, score)
  }

  private isMarketplaceHost(hostname: string): boolean {
    const blocked = [
      'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'aliexpress.com',
      'temu.com', 'joom.com', 'dhgate.com', 'alibaba.com', '1688.com',
    ]
    return blocked.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  }

  private isFacebookProfileUrl(value: string): boolean {
    try {
      const url = new URL(value)
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false
      const blocked = ['/pages/', '/groups/', '/watch', '/reel/', '/marketplace/', '/share/']
      return !blocked.some((path) => url.pathname.toLowerCase().startsWith(path))
        && (url.pathname.split('/').filter(Boolean).length === 1 || url.pathname === '/profile.php')
    } catch {
      return false
    }
  }

  private cleanStoreName(title: string, hostname: string): string {
    const cleaned = title
      .replace(/\s*[-|]\s*(Shopify|Online Store|Official|Buy).*$/i, '')
      .trim()
    return cleaned.length >= 2 && cleaned.length <= 100 ? cleaned : hostname
  }

  private storeNameFromHostname(hostname: string): string {
    const labels = hostname.split('.')
    const identity = (hostname.endsWith('.myshopify.com') ? labels[0] : labels[labels.length - 2]) || hostname
    const name = identity.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase()).trim()
    return name.length >= 2 ? name : hostname
  }

  private assertSearchAllowed(): void {
    const info = this.getSearchCountInfo()
    if (info.current >= info.limit) {
      throw new Error('Daily search limit reached')
    }
  }

  private incrementSearchCount(): void {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    this.searchCount.set(today, current + 1)
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]
  }

  private getSerpApiKey(): string | undefined {
    const value = this.configService.get<string>('SERPAPI_KEY')?.trim()
    return value && value !== 'your-serpapi-key' ? value : undefined
  }

  private countryCode(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value.trim().toLowerCase()
    if (/^[a-z]{2}$/.test(normalized)) return normalized
    return ({
      'united states': 'us',
      'european union': 'de',
      canada: 'ca',
      australia: 'au',
    } as Record<string, string>)[normalized]
  }

  private shouldUseMockResults(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    const enableMockSearch = this.configService.get<string>('ENABLE_MOCK_SEARCH', 'false')
    return nodeEnv !== 'production' || enableMockSearch === 'true'
  }

  private fallbackToMockResults(reason: string): ShopifyStore[] {
    if (this.shouldUseMockResults()) {
      this.logger.warn(`${reason}; returning mock Shopify results for local development.`)
      return this.getMockResults()
    }

    throw new ServiceUnavailableException(`${reason}; configure SERPAPI_KEY or retry later.`)
  }

  private getMockResults(): ShopifyStore[] {
    return [
      {
        name: 'PawSpark',
        url: 'https://pawspark.myshopify.com',
        productUrl: 'https://pawspark.myshopify.com/products/pet-grooming-brush',
        description: 'Pet grooming and care products',
        traffic: { monthlyVisits: 50000, rank: 150000, source: 'mock' },
        source: 'google_search',
        validityScore: 80,
        searchPosition: 1,
      },
      {
        name: 'BlendJetty',
        url: 'https://blendjetty.myshopify.com',
        productUrl: 'https://blendjetty.myshopify.com/products/portable-blender',
        description: 'Portable blender and kitchen gadgets',
        traffic: { monthlyVisits: 35000, rank: 200000, source: 'mock' },
        source: 'google_search',
        validityScore: 75,
        searchPosition: 2,
      },
      {
        name: 'Home Decor Plus',
        url: 'https://home-decor-plus.myshopify.com',
        productUrl: 'https://home-decor-plus.myshopify.com/products/home-decor-set',
        description: 'Home decor and furniture accessories',
        traffic: { monthlyVisits: 25000, rank: 250000, source: 'mock' },
        source: 'google_search',
        validityScore: 70,
        searchPosition: 3,
      },
    ]
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}
