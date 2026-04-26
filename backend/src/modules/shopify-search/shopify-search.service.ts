import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

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
  description?: string
  imageUrl?: string
  traffic?: DomainTraffic
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

  async searchStoresByImageUrl(imageUrl: string): Promise<ShopifyStore[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured')
    }

    const query = `"${imageUrl}" Shopify OR "myshopify.com" OR "collections/all"`
    return this.searchStoresByQuery(query)
  }

  async searchStoresByKeyword(keyword: string): Promise<ShopifyStore[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured')
    }

    return this.searchStoresByQuery(`"${keyword}" allinurl:/collections/all`)
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

  private async searchStoresByQuery(query: string): Promise<ShopifyStore[]> {
    try {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: query,
          api_key: this.getSerpApiKey(),
          num: 20,
        },
        timeout: 30000,
      })

      const results = response.data?.organic_results || []
      const stores = this.extractStores(results)
      if (stores.length === 0) {
        return this.fallbackToMockResults('No Shopify stores were found')
      }
      return stores
    } catch (error: any) {
      this.logger.error(`Shopify search failed: ${error.message}`)
      return this.fallbackToMockResults('Shopify search provider failed')
    }
  }

  private extractStores(items: any[]): ShopifyStore[] {
    const seen = new Set<string>()
    const stores: ShopifyStore[] = []

    for (const item of items) {
      const link = item.link || item.url
      if (!link) continue

      try {
        const url = new URL(link)
        const hostname = url.hostname.replace(/^www\./, '')
        const looksLikeStore =
          hostname.endsWith('myshopify.com') ||
          url.pathname.includes('/collections/') ||
          url.pathname.includes('/products/') ||
          url.pathname.includes('/cart')

        if (!looksLikeStore || seen.has(hostname)) continue
        seen.add(hostname)

        stores.push({
          name: this.cleanStoreName(item.title || hostname, hostname),
          url: `${url.protocol}//${hostname}`,
          description: item.snippet || '',
          imageUrl: item.thumbnail,
          traffic: { monthlyVisits: 1000, source: 'estimated' },
        })
      } catch {
        continue
      }
    }

    return stores.slice(0, 20)
  }

  private cleanStoreName(title: string, hostname: string): string {
    const cleaned = title
      .replace(/\s*[-|]\s*(Shopify|Online Store|Official|Buy).*$/i, '')
      .trim()
    return cleaned.length >= 2 && cleaned.length <= 100 ? cleaned : hostname
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
    return this.configService.get<string>('SERPAPI_KEY')
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
        description: 'Pet grooming and care products',
        traffic: { monthlyVisits: 50000, rank: 150000, source: 'mock' },
      },
      {
        name: 'BlendJetty',
        url: 'https://blendjetty.myshopify.com',
        description: 'Portable blender and kitchen gadgets',
        traffic: { monthlyVisits: 35000, rank: 200000, source: 'mock' },
      },
      {
        name: 'Home Decor Plus',
        url: 'https://home-decor-plus.myshopify.com',
        description: 'Home decor and furniture accessories',
        traffic: { monthlyVisits: 25000, rank: 250000, source: 'mock' },
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
